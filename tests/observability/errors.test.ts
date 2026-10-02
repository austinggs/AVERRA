import { describe, expect, it } from 'vitest';
import { describeError, errorFields, isMissingSchemaError } from '@/lib/observability/errors';

// Regression guard for a defect that occurred at eighteen call sites.
//
// The original pattern was:
//
//   console.error('[x] failed', { error: error.message })
//
// A Supabase client can fail without a `.message`, in which case that logs `{}`.
// The diagnostic is discarded at exactly the moment it is needed, so these tests
// pin the behaviour that makes a failure reportable.

describe('describeError', () => {
  it('extracts a PostgrestError message', () => {
    expect(describeError({ message: 'relation does not exist' })).toBe('relation does not exist');
  });

  it('does not produce an empty result for an error with no message', () => {
    // The exact case that produced `{}` in the original log: a PostgREST error
    // carrying a code but no message. It is serialised rather than discarded, so
    // the code survives into the log line.
    const bare = { code: 'PGRST205' };
    const described = describeError(bare);

    expect(described).not.toBe('');
    expect(described).toContain('PGRST205');
  });

  it('still says something when the object has no useful properties at all', () => {
    expect(describeError({})).toBe('unknown error (no readable properties)');
  });

  it('falls back to a serialised object rather than nothing', () => {
    const odd = { status: 500, detail: 'internal' };

    expect(describeError(odd)).toContain('internal');
  });

  it('handles a bare string', () => {
    expect(describeError('connection refused')).toBe('connection refused');
  });

  it('handles an Error instance', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('handles an Error with no message by using its name', () => {
    expect(describeError(new TypeError())).toBe('TypeError');
  });

  it('handles null and undefined', () => {
    expect(describeError(null)).toContain('null');
    expect(describeError(undefined)).toContain('null');
  });

  it('survives a circular object without throwing', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(() => describeError(circular)).not.toThrow();
  });

  it('prefers a message over other string properties', () => {
    expect(describeError({ message: 'real message', details: 'extra detail' })).toBe(
      'real message',
    );
  });

  it('reads error_description, which OAuth responses carry', () => {
    expect(describeError({ error_description: 'invalid grant' })).toBe('invalid grant');
  });
});

describe('errorFields', () => {
  it('always produces a non-empty error field', () => {
    expect(errorFields({}).error).toBeTruthy();
    expect(errorFields(null).error).toBeTruthy();
  });

  it('includes the PostgREST code, which identifies the cause immediately', () => {
    const fields = errorFields({ message: 'boom', code: '42P01' });

    expect(fields.code).toBe('42P01');
    expect(fields.error).toBe('boom');
  });

  it('includes details and hint when present', () => {
    const fields = errorFields({ message: 'boom', details: 'd', hint: 'h' });

    expect(fields.details).toBe('d');
    expect(fields.hint).toBe('h');
  });

  it('omits absent fields rather than logging undefined', () => {
    const fields = errorFields({ message: 'boom' }) as Record<string, unknown>;

    expect('code' in fields).toBe(false);
    expect('details' in fields).toBe(false);
  });

  it('merges caller context alongside the error', () => {
    const fields = errorFields({ message: 'boom' }, { correlationId: 'abc' });

    expect(fields.correlationId).toBe('abc');
    expect(fields.error).toBe('boom');
  });

  it('never overwrites a caller field with undefined', () => {
    const fields = errorFields({}, { attemptId: 7 });

    expect(fields.attemptId).toBe(7);
  });
});

describe('isMissingSchemaError', () => {
  it('detects an undefined relation, the signature of unapplied migrations', () => {
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true);
  });

  it('detects an undefined column', () => {
    expect(isMissingSchemaError({ code: '42703' })).toBe(true);
  });

  it('detects a PostgREST schema-cache miss', () => {
    expect(isMissingSchemaError({ code: 'PGRST205' })).toBe(true);
  });

  it('detects the prose form, when no code is present', () => {
    expect(isMissingSchemaError({ message: 'relation "app.notifications" does not exist' })).toBe(
      true,
    );
  });

  it('does not misreport an ordinary failure as a schema problem', () => {
    expect(isMissingSchemaError({ message: 'insufficient balance' })).toBe(false);
    expect(isMissingSchemaError({ code: '23514' })).toBe(false);
  });

  it('handles an error with no message without throwing', () => {
    expect(() => isMissingSchemaError({})).not.toThrow();
    expect(isMissingSchemaError({})).toBe(false);
  });
});
