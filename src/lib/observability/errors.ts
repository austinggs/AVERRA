// Error normalisation for database calls.
//
// WHY THIS EXISTS
//
// The pattern `console.error('...', { error: error.message })` appears at
// eighteen call sites and is BROKEN at every one of them. A Supabase client can
// fail without producing a PostgrestError — a fetch rejection, a non-JSON
// response from PostgREST when a relation is missing from its schema cache, or a
// transport error all yield an error object with no `.message`. Logging
// `error.message` then produces `{}`, which is what happens on a database that
// has not had its migrations applied.
//
// The consequence is bad: the one moment you need the diagnostic detail is the
// moment it is silently discarded, and the log line looks like an empty object
// rather than a failure.
//
// This module extracts whatever the error actually carries, so a failing call
// always says something useful. It never invents a message, and it never
// re-throws.

// Doc 12 ABUSE CONTROLS analogy: the signal must survive the reporting path.
type Loose = Record<string, unknown>;

/** Pulls a message out of whatever shape the error actually has. */
export function describeError(error: unknown): string {
  if (error === null || error === undefined) return 'unknown error (null)';
  if (typeof error === 'string') return error;

  if (error instanceof Error) return error.message || error.name || 'Error (no message)';

  if (typeof error === 'object') {
    const loose = error as Loose;

    for (const key of ['message', 'error_description', 'error', 'reason', 'detail']) {
      const value = loose[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }

  try {
    // A stringified object is still better than `{}`.
    const rendered = JSON.stringify(error);
    if (rendered && rendered !== '{}') return rendered;
  } catch {
    // Circular or otherwise unserialisable. Fall through.
  }

  return 'unknown error (no readable properties)';
}

/**
 * The full diagnosable shape of a failed database call.
 *
 * Includes the PostgREST `code` and `details` where present, because a Postgres
 * error code (for example `42P01` for a missing relation) identifies the cause
 * immediately, whereas the prose message may not.
 */
export function errorFields(
  error: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> & { error: string } {
  const loose = (typeof error === 'object' && error !== null ? error : {}) as Loose;

  const code = typeof loose.code === 'string' ? loose.code : undefined;
  const details = typeof loose.details === 'string' ? loose.details : undefined;
  const hint = typeof loose.hint === 'string' ? loose.hint : undefined;

  return {
    ...extra,
    error: describeError(error),
    // Omitted rather than logged as undefined, so the line stays readable.
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
    ...(hint ? { hint } : {}),
  };
}

/**
 * True when the failure is a missing relation or schema.
 *
 * Postgres `42P01` is undefined_table, `42703` is undefined_column. These almost
 * always mean the migrations have not been applied to the connected database,
 * which is worth naming explicitly rather than reporting as a generic failure.
 */
export function isMissingSchemaError(error: unknown): boolean {
  const loose = (typeof error === 'object' && error !== null ? error : {}) as Loose;

  if (typeof loose.code === 'string') {
    if (loose.code === '42P01' || loose.code === '42703' || loose.code === 'PGRST205') {
      return true;
    }
  }

  return /does not exist|not found.*schema cache/i.test(describeError(error));
}
