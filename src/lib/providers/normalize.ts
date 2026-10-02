// Provider payload normalization.
//
// PURE, and deliberately free of `server-only` so it can be unit tested. These
// rules decide whether a provider's claimed value is safe to turn into a reward,
// so every one of them fails closed.
//
// Doc 08 CALLBACK REQUIREMENTS lists the checks: authenticate origin, validate
// signatures, validate required fields, validate provider/campaign/event
// identifiers, enforce timestamp and replay protections, apply idempotency,
// record raw evidence. This module covers the field-level half; the
// database-backed half is in the ingestion route.

import {
  CONVERSION_STATUSES,
  type ConversionStatus,
  type NormalizationResult,
  type NormalizedAmount,
} from '@/lib/providers/types';

/**
 * Maps provider status vocabulary onto ours.
 *
 * Anything unrecognised is REJECTED rather than guessed. Guessing here would
 * mean a provider phrase nobody tested could read as a payout.
 */
const STATUS_ALIASES: Record<string, ConversionStatus> = {
  pending: 'RECEIVED',
  received: 'RECEIVED',
  approved: 'VALIDATED',
  validated: 'VALIDATED',
  qualified: 'VALIDATED',
  completed: 'VALIDATED',
  complete: 'VALIDATED',
  converted: 'VALIDATED',
  credited: 'VALIDATED',
  rejected: 'REJECTED',
  denied: 'REJECTED',
  invalid: 'REJECTED',
  failed: 'REJECTED',
  reversed: 'REVERSED',
  reversal: 'REVERSED',
  chargeback: 'CHARGEBACK',
  fraud: 'REJECTED',
};

export function normalizeStatus(value: unknown): NormalizationResult<ConversionStatus> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: 'status is missing or not a string' };
  }

  const key = value.trim().toLowerCase();
  const mapped = STATUS_ALIASES[key];

  if (!mapped) {
    return { ok: false, reason: `unrecognised provider status: ${key}` };
  }

  return { ok: true, value: mapped };
}

export function isConversionStatus(value: string): value is ConversionStatus {
  return (CONVERSION_STATUSES as readonly string[]).includes(value);
}

/**
 * Parses a provider-supplied amount into integer minor units.
 *
 * Each design decision is a law rather than a preference:
 *
 *  * A DECIMAL STRING is required for a non-integer input. Money arriving as
 *    0.1 + 0.2 must not be accumulated in floating point.
 *  * A NEGATIVE amount is rejected. A provider reversal is a status, not a
 *    negative reward, and accepting a negative here would invert the ledger
 *    direction in a way no later stage expects.
 *  * An EMPTY string is rejected. BigInt('') is 0n and does not throw, so
 *    without an explicit check a missing amount would read as a real zero. See
 *    Q-12 in docs/DISCREPANCIES.md for why that failure mode is dangerous.
 *  * SUB-MINOR precision is reported, never silently rounded.
 */
export function parseAmountMinor(value: unknown): NormalizationResult<bigint> {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: 'amount is not a finite number' };
    }
    if (!Number.isInteger(value)) {
      return { ok: false, reason: 'amount must be an integer or a decimal string' };
    }
    if (value < 0) {
      return { ok: false, reason: 'amount must not be negative' };
    }
    return { ok: true, value: BigInt(value) };
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'amount is missing or not a string or number' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: 'amount is empty' };
  }

  // Exponent notation is rejected: 1e3 is numerically valid but is not a
  // conventional money literal and invites ambiguity about the intended scale.
  if (/[eE]/.test(trimmed)) {
    return { ok: false, reason: 'amount must not use exponent notation' };
  }

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: 'amount is not a valid decimal number' };
  }

  if (trimmed.startsWith('-')) {
    return { ok: false, reason: 'amount must not be negative' };
  }

  // A decimal point means the provider sent a MAJOR-unit amount ("10.00"), not
  // the minor units this field holds. Interpreting it requires knowing the
  // currency's scale, and assuming one would be wrong by a factor of the scale:
  // reading "10.00" as 10 minor units instead of 1000 is a hundredfold payout
  // error in either direction.
  //
  // So it is rejected, and the reason says how to fix it. An earlier version
  // accepted an all-zero fraction and rejected a non-zero one, which was
  // incoherent: "0.50" is exactly 50 minor units and entirely representable.
  if (trimmed.includes('.')) {
    return {
      ok: false,
      reason:
        'amount is a major-unit decimal; send integer minor units or configure the currency scale',
    };
  }

  return { ok: true, value: BigInt(trimmed) };
}

export function normalizeReward(value: unknown, currency: string): NormalizedAmount {
  const parsed = parseAmountMinor(value);

  if (!parsed.ok) {
    return { amountMinor: 0n, currency, error: parsed.reason };
  }

  return { amountMinor: parsed.value, currency };
}

/**
 * Replay window check (doc 08: "enforce timestamp/replay protections").
 *
 * A callback timestamped far in the future is rejected: with a leaked signing
 * key, an attacker could otherwise pin future timestamps and hold a replay window
 * open indefinitely. A callback in the past is NOT rejected on age alone, because
 * a delayed provider callback is legitimate and belongs in reconciliation rather
 * than being silently dropped.
 */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_PAST_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function checkTimestamp(claimed: Date | null, now: Date): NormalizationResult<Date> {
  if (!claimed) {
    return { ok: false, reason: 'callback carried no usable event timestamp' };
  }

  if (Number.isNaN(claimed.getTime())) {
    return { ok: false, reason: 'event timestamp is not a valid date' };
  }

  const skew = claimed.getTime() - now.getTime();

  if (skew > MAX_FUTURE_SKEW_MS) {
    return {
      ok: false,
      reason: `event timestamp is ${Math.round(skew / 1000)}s in the future, beyond the accepted skew`,
    };
  }

  if (-skew > MAX_PAST_AGE_MS) {
    return { ok: false, reason: 'event timestamp is implausibly old' };
  }

  return { ok: true, value: claimed };
}

/** Extracts a required non-empty string field. */
export function requireString(
  source: Record<string, unknown>,
  field: string,
): NormalizationResult<string> {
  const value = source[field];

  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: `required field missing or empty: ${field}` };
  }

  return { ok: true, value: value.trim() };
}
