// CPX Research conversion vocabulary, and the decimal -> minor-unit conversion the
// shared normalizer deliberately refuses to do.
//
// PURE, and free of `server-only`, so both are unit tested without a database.
//
// WHY A CPX-LOCAL AMOUNT CONVERTER EXISTS
//
// `parseAmountMinor` REJECTS any value containing a decimal point:
//
//     'amount is a major-unit decimal; send integer minor units or configure the
//      currency scale'
//
// That is correct and deliberate (see normalize.ts): reading "10.00" as 10 minor
// units instead of 1000 is a hundredfold payout error. CPX sends `amount_local`
// ("1073.48") and `amount_usd` ("0.81") as MAJOR-unit decimals, so every CPX
// callback would otherwise fail normalization.
//
// So the conversion happens HERE, with an explicit scale, and the resulting INTEGER
// is handed to the shared parser, which keeps failing closed for everything else.
// Loosening the shared parser to accept decimals would remove that protection from
// every other provider, so it is not loosened.
//
// NOT A FLOAT MULTIPLICATION. `0.81 * 1325.29` is 1073.4849000000001 in IEEE 754.
// The factor is applied by CPX in their own system; we only re-express their decimal
// string in minor units, digit by digit.

import type { ConversionStatus } from '@/lib/providers/types';

/** CPX sends NGN and USD; NGN has been observed with trailing zeros, see below. */
export const CPX_SCALE = 2;

/** Unit the reward is recorded in. Matches `reward_sources.currency_unit` elsewhere. */
export const CPX_LOCAL_UNIT = 'NGN-kobo';

export type DecimalResult = { ok: true; value: bigint } | { ok: false; reason: string };

/**
 * Converts a provider's major-unit decimal string into integer minor units.
 *
 * TRAILING ZEROS ARE STRIPPED, AND THAT IS NOT ROUNDING.
 *
 * Measured against a live CPX postback on 2026-10-04, the test tool sent
 * `amount_local=662.6500` for a 0.50 USD conversion - four decimal places - while
 * `amount_usd=0.50` arrived with two. The scale is therefore not consistent across
 * fields, and a fixed scale of 2 rejected the local amount outright: every callback
 * failed normalization with `NORMALIZATION_FAILED`, while CPX's dashboard showed a
 * delivered postback and credited revenue. That is the same invisible-failure shape as
 * CR-0030, one layer down.
 *
 * Stripping trailing zeros is EXACT. `662.6500` and `662.65` are the same money, and
 * the conversion below performs no arithmetic on the digits at all - it only removes
 * zeros that carry no value and left-pads the remainder. Nothing is discarded.
 *
 * What is still refused is genuine excess precision: `10.1234` keeps its fourth
 * decimal place after stripping, exceeds the scale, and is rejected. That case is a
 * real rounding decision, and rounding a money figure silently is what this codebase
 * forbids. The rule is deliberately narrow - "no information is lost" - rather than the
 * broader "at most two decimals", which is what the vendor's formatting tripped over.
 */
export function decimalToMinor(value: unknown, scale: number = CPX_SCALE): DecimalResult {
  if (typeof value === 'number') {
    // A number here has already lost exact decimal representation, so it cannot be
    // converted without guessing. Refuse rather than re-derive a string.
    return { ok: false, reason: 'amount arrived as a number; a decimal string is required' };
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'amount is missing or not a string' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    // `Number('') === 0`, so an empty field would otherwise read as a real zero.
    return { ok: false, reason: 'amount is empty' };
  }

  if (/[eE]/.test(trimmed)) {
    return { ok: false, reason: 'amount must not use exponent notation' };
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: 'amount is not a valid non-negative decimal' };
  }

  const [whole, rawFraction = ''] = trimmed.split('.');

  // Exact, not rounding. `662.6500` -> `662.65`. `10.1000` -> `10.1`. `10.1234` is
  // untouched, so the precision check below still sees the fourth decimal place.
  const fraction = rawFraction.replace(/0+$/, '');

  if (fraction.length > scale) {
    return {
      ok: false,
      reason:
        `amount has ${fraction.length} significant decimal places but the scale allows ` +
        `${scale}; refusing to round a money value`,
    };
  }

  const padded = fraction.padEnd(scale, '0');

  return { ok: true, value: BigInt(`${whole}${padded}`) };
}

// -----------------------------------------------------------------------------
// CPX STATUS AND TYPE VOCABULARY
// -----------------------------------------------------------------------------
//
// Both fields are required, and BOTH must be understood before an event is payable.
// CPX documents `status` as 1 = completed, 2 = canceled, and `type` as one of
// return_out, complete, bonus.
//
// The decisive case is the pair. `status=1` alone is not enough: a `return_out` also
// carries a status, and paying on it would pay a user for a survey they abandoned.
// Equally, `type=complete` alone is not enough, because the same transaction arrives
// again with a reversal status when CPX detects fraud 15-60 days later.
//
// CPX USES TWO REVERSAL STATUSES, AND THE SECOND ONE IS NOT IN THEIR FIELD LIST.
//
// The INFORMATION panel documents only `1 = completed, 2 = canceled`. A second
// advisory panel on the same screen - visible only on the wider publisher layout -
// states:
//
//     "Your postback URL will be called by us a second time, as soon as we cancel a
//      transaction. &status=1 (pending) to &status=-2 (reversed)."
//
// So `-2` is the fraud reversal, and it is the one that arrives 15-60 days later -
// precisely the event this system exists to catch. Matching only `'2'` classified
// `-2` as UNKNOWN with a null conversion status, `handleCallback` returned null, and
// the reversal was discarded with no conversion row at all. That is worse than
// discarding it as a duplicate: a duplicate still leaves the original visible, while
// an unknown status leaves no trace that a reversal was ever offered.
//
// `2` is retained as a reversal rather than dropped, because their own panel
// documents it as the cancellation value. Both are checked, and both are reversible.

export type CpxEventKind = 'PAYABLE' | 'REVERSAL' | 'INFORMATIONAL';

/** Statuses CPX uses to withdraw a transaction. See the note above. */
const REVERSAL_STATUSES = new Set(['2', '-2']);

/**
 * The provider event id a reversal is recorded under.
 *
 * THE DEFECT THIS FIXES. CPX re-notifies a transaction with the SAME `trans_id` and a
 * reversal status. Carrying that id unchanged meant law 5's unique index on
 * (provider_id, provider_event_id) returned the ORIGINAL conversion as a DUPLICATE,
 * and the fraud clawback was discarded with no reversal row, no `reverse_conversion`
 * call and no error anywhere - while CPX's dashboard showed it delivered.
 *
 * A reversal is a distinct business event about a distinct thing that happened, so it
 * gets a distinct identity. The original completion keeps `trans_id` untouched: its
 * `provider_event_id` is not rewritten, only a new row is added beside it.
 *
 * The suffix keeps the vendor's value verbatim, so `2` and `-2` stay distinct. A
 * numeric comparison would conflate them, and they are both real.
 *
 * Replay safety survives: CPX sending `status=-2` twice produces the same suffix both
 * times, so the unique index still collapses the duplicate.
 */
export function cpxReversalEventId(transactionId: string, status: string): string {
  return `${transactionId}:${status}`;
}

/**
 * Classifies a (status, type) pair.
 *
 * `UNKNOWN` is a distinct outcome rather than a failure, so an unrecognised pair is
 * recorded as evidence and reported, never mapped onto a payout. A phrase nobody
 * tested must not read as money.
 */
export function classifyCpxEvent(
  status: unknown,
  type: unknown,
): {
  kind: CpxEventKind | 'UNKNOWN';
  conversionStatus: ConversionStatus | null;
  reason?: string;
} {
  const statusText = typeof status === 'string' ? status.trim() : String(status ?? '').trim();
  const typeText = typeof type === 'string' ? type.trim().toLowerCase() : '';

  // A cancellation can arrive with any `type`, because it is a re-notification about
  // a transaction that was previously something else. It is checked FIRST so a
  // reversed completion is never classified as a fresh completion.
  if (REVERSAL_STATUSES.has(statusText)) {
    return {
      kind: 'REVERSAL',
      conversionStatus: 'REVERSED',
      reason: `cpx reported status ${statusText}: the transaction was canceled or reversed as fraud`,
    };
  }

  if (statusText !== '1') {
    return {
      kind: 'UNKNOWN',
      conversionStatus: null,
      reason: `unrecognised cpx status: ${statusText || '(missing)'}`,
    };
  }

  if (typeText === 'complete') {
    return { kind: 'PAYABLE', conversionStatus: 'VALIDATED' };
  }

  // return_out: the user was sent to a survey and returned without completing it.
  // bonus: a screen-out or rating courtesy payment. Neither is money we owe a user
  // for work they completed, and both are recorded rather than discarded.
  if (typeText === 'return_out' || typeText === 'bonus') {
    return {
      kind: 'INFORMATIONAL',
      conversionStatus: 'RECEIVED',
      reason: `cpx type "${typeText}" carries no completed survey`,
    };
  }

  return {
    kind: 'UNKNOWN',
    conversionStatus: null,
    reason: `unrecognised cpx type: ${typeText || '(missing)'}`,
  };
}
