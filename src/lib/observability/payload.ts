// Outbox event payload readers.
//
// PURE, and deliberately free of `server-only` so they can be unit tested. They
// parse JSON that arrived from Postgres, where a bigint is transmitted as a
// STRING. A reader that only handled numbers would silently drop every amount,
// which is a financial-correctness bug rather than a style issue, so both
// shapes are handled and the string form is the expected one.

/** Reads a string field, treating empty and missing alike. */
export function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a minor-unit amount as a bigint.
 *
 * Accepts the string form Postgres actually sends, and an integer number for
 * direct calls. A fractional number is rejected rather than truncated, because a
 * silently truncated money value is worse than a null the caller can notice.
 */
export function readAmount(payload: Record<string, unknown>, key: string): bigint | null {
  const value = payload[key];

  if (typeof value === 'string') {
    // BigInt('') and BigInt(' ') both return 0n rather than throwing, so an
    // absent amount would be read as a real zero and produce a "0 NGN"
    // notification. The emptiness check must come first.
    if (value.trim().length === 0) return null;

    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value);
  }

  return null;
}

/**
 * Formats an amount for user-facing notification text. A missing amount produces
 * neutral wording rather than "null", because these strings are shown to users.
 */
export function describeAmount(amount: bigint | null, unit: string | null): string {
  if (amount === null) return 'the recorded amount';
  return unit ? `${amount} ${unit}` : amount.toString(10);
}
