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

/** CPX sends NGN and USD, both with two decimal places. */
export const CPX_SCALE = 2;

/** Unit the reward is recorded in. Matches `reward_sources.currency_unit` elsewhere. */
export const CPX_LOCAL_UNIT = 'NGN-kobo';

export type DecimalResult = { ok: true; value: bigint } | { ok: false; reason: string };

/**
 * Converts a provider's major-unit decimal string into integer minor units.
 *
 * Refuses rather than rounds when the value carries more precision than the scale.
 * Rounding here would be an unrecorded change to a money figure, and the codebase's
 * rule is that sub-minor precision is reported, never silently discarded.
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

  const [whole, fraction = ''] = trimmed.split('.');

  if (fraction.length > scale) {
    return {
      ok: false,
      reason:
        `amount has ${fraction.length} decimal places but the scale allows ${scale}; ` +
        'refusing to round a money value',
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
// again with `status=2` when CPX detects fraud 15-60 days later.

export type CpxEventKind = 'PAYABLE' | 'REVERSAL' | 'INFORMATIONAL';

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
  if (statusText === '2') {
    return {
      kind: 'REVERSAL',
      conversionStatus: 'REVERSED',
      reason: 'cpx reported status 2: the transaction was canceled or reversed as fraud',
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
