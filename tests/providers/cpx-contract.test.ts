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

  // THE DEFECT THIS SUITE FAILED TO CATCH, MEASURED AGAINST A LIVE POSTBACK.
  //
  // CPX's test tool sent `amount_local=662.6500` on 2026-10-04 - four decimal places -
  // for a 0.50 USD conversion, while `amount_usd` arrived as `0.50` with two. The old
  // check compared raw fractional length against a fixed scale of 2, so it rejected the
  // local amount, `handleCallback` returned null, and EVERY CPX callback failed
  // normalization with `NORMALIZATION_FAILED` while the vendor dashboard reported the
  // postback as delivered and credited the revenue.
  //
  // Stripping trailing zeros is exact, not rounding: no information is discarded.
  it('strips TRAILING ZEROS from the live 662.6500 figure without rounding', () => {
    const result = decimalToMinor('662.6500');

    expect(result.ok).toBe(true);
    // 662.65 NGN -> 66265 kobo. Identical to what `662.65` produces.
    expect(result.ok && result.value).toBe(66265n);
    expect(result.ok && result.value).toBe(
      decimalToMinor('662.65').ok
        ? (decimalToMinor('662.65') as { ok: true; value: bigint }).value
        : 0n,
    );
  });

  it('produces the same minor units however many trailing zeros CPX pads', () => {
    const values = ['662.65', '662.650', '662.6500', '662.65000'];
    const converted = values.map((v) => decimalToMinor(v));

    for (const result of converted) expect(result.ok).toBe(true);

    const distinct = new Set(converted.map((r) => (r.ok ? r.value.toString() : 'refused')));
    expect(distinct.size).toBe(1);
  });

  it('still refuses a NON-ZERO fourth decimal place, which would be real rounding', () => {
    // `662.6501` keeps its fourth place after stripping, so this must NOT pass. The
    // distinction from `662.6500` is the whole point: only zeros are removable.
    const result = decimalToMinor('662.6501');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/refusing to round/);
  });

  it('still refuses excess precision that happens to end in a zero', () => {
    // `10.1230` strips to `10.123`, which is still three places against a scale of 2.
    const result = decimalToMinor('10.1230');

    expect(result.ok).toBe(false);
  });

  it('treats an all-zero fraction as a real zero, not as excess precision', () => {
    const result = decimalToMinor('5.0000');

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(500n);
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

  // THE FRAUD REVERSAL, WHICH IS NOT IN CPX'S OWN FIELD LIST.
  //
  // Their INFORMATION panel documents `1 = completed, 2 = canceled`. A second advisory
  // panel on the same screen states: "Your postback URL will be called by us a second
  // time, as soon as we cancel a transaction. &status=1 (pending) to &status=-2
  // (reversed)."
  //
  // So `-2` is the value that actually arrives 15-60 days later, when a completion is
  // reclassified as fraud. Matching only '2' classified it UNKNOWN with a null
  // conversion status, `handleCallback` returned null, and the reversal was discarded
  // with NO conversion row - leaving no trace that a reversal was ever offered.
  it('reverses on status -2, the fraud reversal CPX documents separately', () => {
    const result = classifyCpxEvent('-2', 'complete');

    expect(result.kind).toBe('REVERSAL');
    expect(result.conversionStatus).toBe('REVERSED');
  });

  it('reverses on -2 regardless of the type it arrives with', () => {
    for (const type of ['complete', 'return_out', 'bonus']) {
      expect(classifyCpxEvent('-2', type).conversionStatus).toBe('REVERSED');
    }
  });

  it('tolerates whitespace around the -2 they may send', () => {
    expect(classifyCpxEvent(' -2 ', 'complete').conversionStatus).toBe('REVERSED');
  });

  // The asymmetry matters: -2 must NEVER be payable, and 1 must never be a reversal.
  it('keeps -2 out of PAYABLE and 1 out of REVERSAL', () => {
    expect(classifyCpxEvent('-2', 'complete').kind).not.toBe('PAYABLE');
    expect(classifyCpxEvent('1', 'complete').kind).not.toBe('REVERSAL');
  });

  // `-2` and `2` are distinct strings. A numeric comparison would conflate them, and
  // `parseInt('-2')` is where that temptation starts.
  it('does not treat -2 as 2 by numeric coercion', () => {
    expect(Number('-2')).not.toBe(Number('2'));
    expect(classifyCpxEvent('-2', 'complete').reason).toContain('-2');
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
  //
  // `-2` is in this population because omitting it is precisely how the fraud reversal
  // escaped: the old list was `['1','2','0','x',undefined]`, so a sweep over the
  // vocabulary CPX actually sends never exercised the one value that matters most.
  it('makes PAYABLE reachable for exactly one combination', () => {
    const statuses = ['1', '2', '-2', '0', 'x', undefined];
    const types = ['complete', 'return_out', 'bonus', 'other', undefined];

    const payable = statuses
      .flatMap((s) => types.map((t) => classifyCpxEvent(s, t)))
      .filter((r) => r.kind === 'PAYABLE');

    expect(payable).toHaveLength(1);
  });

  // The same sweep, asserting every status CPX sends is UNDERSTOOD. A documented value
  // yielding UNKNOWN is a value we would silently drop.
  it('leaves no documented cpx status unrecognised', () => {
    for (const status of ['1', '2', '-2']) {
      for (const type of ['complete', 'return_out', 'bonus']) {
        expect(classifyCpxEvent(status, type).kind).not.toBe('UNKNOWN');
      }
    }
  });

  it('records the currency it normalises into', () => {
    expect(CPX_LOCAL_UNIT).toBe('NGN-kobo');
  });
});
