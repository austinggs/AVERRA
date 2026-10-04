import { describe, expect, it } from 'vitest';
import {
  CPX_LOCAL_UNIT,
  CPX_SCALE,
  classifyCpxEvent,
  decimalToMinor,
} from '@/lib/providers/adapters/cpx-contract';
import { parseAmountMinor } from '@/lib/providers/normalize';

// THE CONVERSION THAT HAD TO BE WRITTEN.
//
// `parseAmountMinor` rejects every decimal, deliberately, because reading "10.00" as
// 10 minor units instead of 1000 is a hundredfold payout error. CPX sends
// `amount_local` as a major-unit decimal, so this converter exists to bridge that gap
// WITHOUT loosening the shared parser for every other provider.
describe('decimalToMinor', () => {
  it('converts a real CPX figure at the configured factor', () => {
    // 1 USD at the publisher's 1325.29 factor is 1073.48 NGN for a 0.81 USD survey.
    const result = decimalToMinor('1073.48');

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(107348n);
  });

  it('converts an amount with no decimal part', () => {
    const result = decimalToMinor('500');

    expect(result.ok && result.value).toBe(50000n);
  });

  it('pads a short fraction rather than misreading it', () => {
    const result = decimalToMinor('12.5');

    expect(result.ok && result.value).toBe(1250n);
  });

  it('accepts zero as a real zero, not as a missing value', () => {
    const result = decimalToMinor('0.00');

    expect(result.ok && result.value).toBe(0n);
  });

  // NOT a float multiplication. 0.81 * 1325.29 is 1073.4849000000001 in IEEE 754, so a
  // float path would either lose kobo or invent them.
  it('never accumulates in floating point', () => {
    const result = decimalToMinor('0.1');

    expect(result.ok && result.value).toBe(10n);
    expect(result.ok && result.value.toString()).toBe('10');
  });

  it('refuses an empty string rather than reading it as zero', () => {
    expect(decimalToMinor('').ok).toBe(false);
  });

  it('refuses a number, because its exact decimal text is already lost', () => {
    expect(decimalToMinor(0.1).ok).toBe(false);
  });

  it('refuses a negative amount', () => {
    // A provider reversal is a STATUS, not a negative reward.
    expect(decimalToMinor('-5.00').ok).toBe(false);
  });

  it('refuses exponent notation', () => {
    expect(decimalToMinor('1e3').ok).toBe(false);
  });

  it('refuses excess precision instead of rounding a money value', () => {
    const result = decimalToMinor('1073.4849', CPX_SCALE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/refusing to round/);
  });

  it('round-trips through the shared integer parser unchanged', () => {
    const minor = decimalToMinor('1073.48');
    expect(minor.ok).toBe(true);
    if (!minor.ok) return;

    // The bridge: a CPX decimal becomes an integer the shared parser accepts, so its
    // own guarantees still apply to the result.
    const reparsed = parseAmountMinor(minor.value.toString());
    expect(reparsed.ok).toBe(true);
    expect(reparsed.ok && reparsed.value).toBe(107348n);
  });
});

// STATUS x TYPE IS A PAIR, NOT A FIELD.
//
// `status=1` alone must not pay: a `return_out` also carries a status, and paying it
// would pay a user for a survey they abandoned. Equally `type=complete` alone must not
// pay, because the same transaction arrives again with status=2 when CPX detects
// fraud 15-60 days later.
describe('classifyCpxEvent', () => {
  it('pays only a completed survey', () => {
    const result = classifyCpxEvent('1', 'complete');

    expect(result.kind).toBe('PAYABLE');
    expect(result.conversionStatus).toBe('VALIDATED');
  });

  it('treats a return_out as information, not a payout', () => {
    const result = classifyCpxEvent('1', 'return_out');

    expect(result.kind).toBe('INFORMATIONAL');
    expect(result.conversionStatus).not.toBe('VALIDATED');
  });

  it('treats a bonus as information, not a payout', () => {
    const result = classifyCpxEvent('1', 'bonus');

    expect(result.kind).toBe('INFORMATIONAL');
    expect(result.conversionStatus).not.toBe('VALIDATED');
  });

  // The cancellation check comes FIRST, because a reversal is a re-notification about
  // a transaction that used to be something else.
  it('reverses a completion that comes back as status 2', () => {
    const result = classifyCpxEvent('2', 'complete');

    expect(result.kind).toBe('REVERSAL');
    expect(result.conversionStatus).toBe('REVERSED');
  });

  it('reverses regardless of the type it arrives with', () => {
    for (const type of ['complete', 'return_out', 'bonus']) {
      expect(classifyCpxEvent('2', type).conversionStatus).toBe('REVERSED');
    }
  });

  it('refuses an unrecognised status rather than guessing', () => {
    const result = classifyCpxEvent('7', 'complete');

    expect(result.kind).toBe('UNKNOWN');
    expect(result.conversionStatus).toBeNull();
  });

  it('refuses an unrecognised type rather than guessing', () => {
    const result = classifyCpxEvent('1', 'something_new');

    expect(result.kind).toBe('UNKNOWN');
    expect(result.conversionStatus).toBeNull();
  });

  it('refuses a missing status or type', () => {
    expect(classifyCpxEvent(undefined, 'complete').conversionStatus).toBeNull();
    expect(classifyCpxEvent('1', undefined).conversionStatus).toBeNull();
    expect(classifyCpxEvent(null, null).conversionStatus).toBeNull();
  });

  it('is case insensitive on the type, which CPX sends lowercase', () => {
    expect(classifyCpxEvent('1', 'COMPLETE').kind).toBe('PAYABLE');
  });

  // NOBODY may reach PAYABLE except the one documented pair.
  it('makes PAYABLE reachable for exactly one combination', () => {
    const statuses = ['1', '2', '0', 'x', undefined];
    const types = ['complete', 'return_out', 'bonus', 'other', undefined];

    const payable = statuses
      .flatMap((s) => types.map((t) => classifyCpxEvent(s, t)))
      .filter((r) => r.kind === 'PAYABLE');

    expect(payable).toHaveLength(1);
  });

  it('records the currency it normalises into', () => {
    expect(CPX_LOCAL_UNIT).toBe('NGN-kobo');
  });
});
