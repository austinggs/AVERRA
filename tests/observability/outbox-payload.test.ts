import { describe, expect, it } from 'vitest';
import { readString, readAmount, describeAmount } from '@/lib/observability/payload';

// Outbox payload readers.
//
// These parse event payloads that arrive as JSON. Postgres sends bigint as a
// STRING over JSON, so a reader that only handled numbers would silently drop
// every amount. That is a financial-correctness issue, not a style one, so the
// two shapes are pinned here.

describe('readString', () => {
  it('returns a present non-empty string', () => {
    expect(readString({ userId: 'u-1' }, 'userId')).toBe('u-1');
  });

  it('returns null for a missing key', () => {
    expect(readString({}, 'userId')).toBeNull();
  });

  it('returns null for an empty string, so "" is not treated as an id', () => {
    expect(readString({ userId: '' }, 'userId')).toBeNull();
  });

  it('returns null for a non-string value', () => {
    expect(readString({ userId: 42 }, 'userId')).toBeNull();
    expect(readString({ userId: null }, 'userId')).toBeNull();
    expect(readString({ userId: { id: 'u' } }, 'userId')).toBeNull();
  });
});

describe('readAmount', () => {
  it('parses the string form, which is how Postgres sends bigint', () => {
    expect(readAmount({ amountMinor: '1000' }, 'amountMinor')).toBe(1000n);
  });

  it('parses a very large amount without precision loss', () => {
    // Number.MAX_SAFE_INTEGER is 2^53-1. A bigint that large must not round.
    expect(readAmount({ amountMinor: '9007199254740993' }, 'amountMinor')).toBe(9007199254740993n);
  });

  it('parses an integer number for direct calls', () => {
    expect(readAmount({ amountMinor: 250 }, 'amountMinor')).toBe(250n);
  });

  it('rejects a fractional number rather than truncating it', () => {
    expect(readAmount({ amountMinor: 12.5 }, 'amountMinor')).toBeNull();
  });

  it('returns null for an unparseable string rather than throwing', () => {
    expect(readAmount({ amountMinor: 'not-a-number' }, 'amountMinor')).toBeNull();
  });

  it('returns null for an empty string, not zero', () => {
    // BigInt('') is 0n, so without an explicit emptiness check an absent amount
    // would be read as a real zero and rendered to the user as "0 NGN".
    expect(readAmount({ amountMinor: '' }, 'amountMinor')).toBeNull();
  });

  it('returns null for a whitespace-only string, not zero', () => {
    // BigInt(' ') is also 0n. Same defect, same guard.
    expect(readAmount({ amountMinor: '   ' }, 'amountMinor')).toBeNull();
  });

  it('reads a zero amount as zero, because a real zero is a real value', () => {
    expect(readAmount({ amountMinor: '0' }, 'amountMinor')).toBe(0n);
  });

  it('tolerates surrounding whitespace on a genuine amount', () => {
    expect(readAmount({ amountMinor: ' 1000 ' }, 'amountMinor')).toBe(1000n);
  });

  it('returns null for a missing key', () => {
    expect(readAmount({}, 'amountMinor')).toBeNull();
  });

  it('rejects a negative-as-positive assumption: a negative is still a bigint', () => {
    // A negative amount should never appear, but if it does it must be visible to
    // the caller rather than coerced to null and silently dropped.
    expect(readAmount({ amountMinor: '-50' }, 'amountMinor')).toBe(-50n);
  });
});

describe('describeAmount', () => {
  it('combines amount and unit when both are present', () => {
    expect(describeAmount(1000n, 'NGN')).toBe('1000 NGN');
  });

  it('shows the bare amount when the unit is unknown', () => {
    expect(describeAmount(1000n, null)).toBe('1000');
  });

  it('uses safe wording when the amount could not be read', () => {
    expect(describeAmount(null, 'NGN')).toBe('the recorded amount');
  });
});
