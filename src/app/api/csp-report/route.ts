import { logger } from '@/lib/observability/logger';

// CSP violation report collector (CR-0039).
//
// Reached ONLY by browsers, per the `report-uri` directive in `src/lib/ads/csp.ts`.
//
// This endpoint is unauthenticated by necessity. A browser posts a violation report
// from whatever page triggered it; there is no session to present and no cookie on a
// cold visit. `src/lib/auth/public-paths.ts` keeps the proxy from redirecting it.
//
// WHY IT LOGS AND DOES NOT STORE
//
// Nothing here is financial, identity-bearing or authoritative. It is attacker-
// reachable diagnostics, and a table would be an unauthenticated write surface with
// a retention obligation attached. Structured logs already reach our aggregator,
// which is where a violation belongs at this stage of the rollout. Persisting them
// is a later decision that belongs with the enforcement flip, not with the first
// version of a collector.
//
// WHY EVERY FIELD IS BOUNDED BEFORE IT IS READ
//
// The body is attacker-controlled and `request.text()` will happily allocate as much
// memory as a client sends. The size cap is checked on `content-length` FIRST so an
// oversized request is refused without being read, and re-checked on the decoded
// string because `content-length` is a client-supplied hint that may lie, be absent,
// or describe compressed bytes.

/**
 * 16 KiB.
 *
 * A realistic `application/csp-report` body containing a handful of violations is
 * well under 1 KiB; `application/reports+json` batches stay in the same order. 16
 * KiB leaves generous headroom while keeping the worst-case allocation bounded and
 * small enough that it cannot be used to pressure the process.
 */
const MAX_REPORT_BYTES = 16 * 1024;

/** How many violation entries from one request are logged. */
const MAX_REPORTED_VIOLATIONS = 5;

/** A single violation as the browser serializes it. */
type CspViolation = {
  'document-uri'?: unknown;
  'violated-directive'?: unknown;
  'effective-directive'?: unknown;
  'blocked-uri'?: unknown;
  'source-file'?: unknown;
  'line-number'?: unknown;
  'status-code'?: unknown;
  disposition?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A number that may legitimately be 0, and may also be absent or a string. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Reads at most one of the two shapes the Reporting API uses.
 *
 * `application/csp-report` nests under `csp-report`; `application/reports+json` is an
 * array with a `type`. Handled here rather than in a library so the size cap and the
 * field bounds apply to both.
 */
function extractViolations(parsed: unknown): CspViolation[] {
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => {
        const body = (entry as { body?: unknown })?.body;
        return body && typeof body === 'object' ? (body as CspViolation) : null;
      })
      .filter((entry): entry is CspViolation => entry !== null);
  }

  if (parsed && typeof parsed === 'object') {
    const body = (parsed as { 'csp-report'?: unknown })['csp-report'];
    if (body && typeof body === 'object') return [body as CspViolation];
  }

  return [];
}

export async function POST(request: Request): Promise<Response> {
  // Refuse BEFORE reading. A missing or non-numeric content-length falls through to
  // the post-read check rather than being trusted as zero.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_BYTES) {
    return new Response(null, { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response(null, { status: 400 });
  }

  if (raw.length > MAX_REPORT_BYTES) {
    return new Response(null, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed body is not worth a warning: some clients send an empty body on
    // speculative preflight. Debug level, and still a success from the browser's
    // perspective so it does not retry.
    logger.debug('security.csp_report_unparseable', { bytes: raw.length });
    return new Response(null, { status: 204 });
  }

  const violations = extractViolations(parsed);

  // Count the whole population. A capped log that does not say how many it dropped
  // reads as "this was everything", which is the reporting shape AGENTS.md warns
  // about for the leak check.
  logger.warn('security.csp_violation', {
    total: violations.length,
    logged: Math.min(violations.length, MAX_REPORTED_VIOLATIONS),
    reportedOnly: true,
    violations: violations.slice(0, MAX_REPORTED_VIOLATIONS).map((violation) => ({
      documentUri: asString(violation['document-uri']),
      violatedDirective: asString(violation['violated-directive']),
      effectiveDirective: asString(violation['effective-directive']),
      blockedUri: asString(violation['blocked-uri']),
      sourceFile: asString(violation['source-file']),
      lineNumber: asNumber(violation['line-number']),
      statusCode: asNumber(violation['status-code']),
      disposition: asString(violation.disposition),
    })),
  });

  // 204, not 200. A 2xx body invites the browser to cache a diagnostic response.
  return new Response(null, { status: 204 });
}

/** A browser may preflight the report endpoint. Answer without doing any work. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}