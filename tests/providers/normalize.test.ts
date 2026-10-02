import { describe, expect, it } from 'vitest';
import {
  MAX_FUTURE_SKEW_MS,
  checkTimestamp,
  normalizeReward,
  normalizeStatus,
  parseAmountMinor,
  requireString,
} from '@/lib/providers/normalize';
import { PROVIDER_STATES, canProduceReward } from '@/lib/providers/types';

// Doc 08 CALLBACK REQUIREMENTS and doc 67 PROVIDER CALLBACKS security tests:
// forged signature, malformed payload, replay, duplicate, delayed callback,
// incorrect amount. These cover the field-level half of that list.

describe('normalizeStatus', () => {
  it('maps known provider vocabulary onto our enum', () => {
    expect(normalizeStatus('approved')).toEqual({ ok: true, value: 'VALIDATED' });
    expect(normalizeStatus('completed')).toEqual({ ok: true, value: 'VALIDATED' });
    expect(normalizeStatus('pending')).toEqual({ ok: true, value: 'RECEIVED' });
    expect(normalizeStatus('rejected')).toEqual({ ok: true, value: 'REJECTED' });
    expect(normalizeStatus('chargeback')).toEqual({ ok: true, value: 'CHARGEBACK' });
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeStatus('  APPROVED  ')).toEqual({ ok: true, value: 'VALIDATED' });
  });

  it('refuses an unrecognised status rather than guessing', () => {
    // Guessing here would mean an untested provider phrase could read as a payout.
    expect(normalizeStatus('probably_fine').ok).toBe(false);
  });

  it('refuses a missing or empty status', () => {
    expect(normalizeStatus(undefined).ok).toBe(false);
    expect(normalizeStatus('').ok).toBe(false);
    expect(normalizeStatus('   ').ok).toBe(false);
    expect(normalizeStatus(42).ok).toBe(false);
  });

  it('never maps anything to REVERSED except an explicit reversal', () => {
    expect(normalizeStatus('reversed')).toEqual({ ok: true, value: 'REVERSED' });
    expect(normalizeStatus('rejected')).not.toEqual({ ok: true, value: 'REVERSED' });
  });
});

describe('parseAmountMinor', () => {
  it('parses an integer string', () => {
    expect(parseAmountMinor('1000')).toEqual({ ok: true, value: 1000n });
  });

  it('rejects a major-unit decimal rather than guessing the scale', () => {
    // "10.00" is ambiguous: 10 minor units or 1000? Assuming either would be a
    // hundredfold payout error, so it is refused and the fix is named.
    expect(parseAmountMinor('10.00').ok).toBe(false);
    expect(parseAmountMinor('0.50').ok).toBe(false);
    expect(parseAmountMinor('1.005').ok).toBe(false);
  });

  it('names the scale configuration in the rejection reason', () => {
    const result = parseAmountMinor('10.00');
    expect(result.ok === false && result.reason).toMatch(/scale/i);
  });

  it('accepts a bare integer as minor units', () => {
    expect(parseAmountMinor('1000')).toEqual({ ok: true, value: 1000n });
    expect(parseAmountMinor('50')).toEqual({ ok: true, value: 50n });
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseAmountMinor('9007199254740993')).toEqual({
      ok: true,
      value: 9007199254740993n,
    });
  });

  it('reads a genuine zero as zero', () => {
    expect(parseAmountMinor('0')).toEqual({ ok: true, value: 0n });
    expect(parseAmountMinor(0)).toEqual({ ok: true, value: 0n });
  });

  it('rejects an empty string rather than reading it as zero', () => {
    // BigInt('') is 0n and does not throw. See Q-12.
    expect(parseAmountMinor('').ok).toBe(false);
    expect(parseAmountMinor('   ').ok).toBe(false);
  });

  it('rejects a negative amount', () => {
    // A reversal is a status, not negative money.
    expect(parseAmountMinor('-1').ok).toBe(false);
    expect(parseAmountMinor(-1).ok).toBe(false);
  });

  it('rejects a fractional number rather than truncating it', () => {
    expect(parseAmountMinor(12.5).ok).toBe(false);
  });

  it('rejects sub-minor-unit precision rather than silently rounding', () => {
    // A major-unit decimal is refused, so a fractional minor-unit figure can
    // never be quietly truncated into a smaller payout.
    const result = parseAmountMinor('1.005');
    expect(result.ok).toBe(false);
  });

  it('rejects exponent notation', () => {
    expect(parseAmountMinor('1e3').ok).toBe(false);
  });

  it('rejects non-numeric junk', () => {
    expect(parseAmountMinor('abc').ok).toBe(false);
    expect(parseAmountMinor(null).ok).toBe(false);
    expect(parseAmountMinor(undefined).ok).toBe(false);
    expect(parseAmountMinor({}).ok).toBe(false);
  });

  it('rejects Infinity and NaN', () => {
    expect(parseAmountMinor(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseAmountMinor(Number.NaN).ok).toBe(false);
  });
});

describe('normalizeReward', () => {
  it('returns the amount and currency on success', () => {
    expect(normalizeReward('2500', 'NGN')).toEqual({ amountMinor: 2500n, currency: 'NGN' });
  });

  it('reports an error instead of returning a usable zero amount on failure', () => {
    expect(normalizeReward('oops', 'NGN').error).toBeDefined();
  });
});

describe('checkTimestamp', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');

  it('accepts a timestamp inside the window', () => {
    expect(checkTimestamp(new Date('2026-09-30T11:59:00.000Z'), now).ok).toBe(true);
  });

  it('rejects a null timestamp', () => {
    expect(checkTimestamp(null, now).ok).toBe(false);
  });

  it('rejects an invalid date', () => {
    expect(checkTimestamp(new Date('not-a-date'), now).ok).toBe(false);
  });

  it('rejects a timestamp far in the future', () => {
    // With a leaked signing key an attacker could pin future timestamps and
    // hold a replay window open indefinitely.
    const future = new Date(now.getTime() + MAX_FUTURE_SKEW_MS + 60_000);
    expect(checkTimestamp(future, now).ok).toBe(false);
  });

  it('accepts a small future skew', () => {
    expect(checkTimestamp(new Date(now.getTime() + 30_000), now).ok).toBe(true);
  });

  it('accepts a delayed callback rather than dropping the evidence', () => {
    // A provider callback that arrives late is legitimate and belongs in
    // reconciliation, not silent rejection.
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(checkTimestamp(yesterday, now).ok).toBe(true);
  });

  it('rejects an implausibly old timestamp', () => {
    const ancient = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect(checkTimestamp(ancient, now).ok).toBe(false);
  });
});

describe('requireString', () => {
  it('returns a trimmed value', () => {
    expect(requireString({ a: '  x  ' }, 'a')).toEqual({ ok: true, value: 'x' });
  });

  it('rejects missing, empty and non-string values', () => {
    expect(requireString({}, 'a').ok).toBe(false);
    expect(requireString({ a: '' }, 'a').ok).toBe(false);
    expect(requireString({ a: '   ' }, 'a').ok).toBe(false);
    expect(requireString({ a: 1 }, 'a').ok).toBe(false);
  });
});

describe('canProduceReward', () => {
  it('permits only a LIVE provider to mint a reward', () => {
    expect(canProduceReward('LIVE')).toBe(true);
  });

  it('refuses every other lifecycle state', () => {
    for (const state of PROVIDER_STATES) {
      if (state === 'LIVE') continue;
      expect(canProduceReward(state)).toBe(false);
    }
  });

  it('refuses a SUSPENDED provider specifically', () => {
    // The realistic abuse case: a provider is suspended and its postback arrives.
    expect(canProduceReward('SUSPENDED')).toBe(false);
  });
});
