// Platform Service & Maintenance Fee.
//
// Spec: 83_MONETIZATION_PAID_PERKS.md (15% of the gross eligible withdrawal),
//       37_WITHDRAWAL_SYSTEM.txt (disclose gross/fee/net before confirmation),
//       71_ARCHITECTURAL_LAWS.md law 45 (fee recorded separately),
//       law 46 (the fee never alters reward economics or eligibility).
//
// Amounts are integer MINOR UNITS (for example kobo). Floating point is never
// used for money in Averra.
//
// The fee applies to eligible WITHDRAWALS ONLY. It is never applied to an
// ordinary user funding deposit (doc 83: "not applied to user-funded deposits").

export const FEE_BASIS_POINTS = 1500;
export const BASIS_POINTS_DENOMINATOR = 10_000;

export type WithdrawalFee = {
  grossMinor: bigint;
  feeMinor: bigint;
  netMinor: bigint;
  feeBasisPoints: number;
};

export function calculateWithdrawalFee(
  grossMinor: bigint,
  feeBasisPoints: number = FEE_BASIS_POINTS,
): WithdrawalFee {
  if (grossMinor < 0n) {
    throw new Error('calculateWithdrawalFee: grossMinor must not be negative');
  }
  if (
    !Number.isInteger(feeBasisPoints) ||
    feeBasisPoints < 0 ||
    feeBasisPoints > BASIS_POINTS_DENOMINATOR
  ) {
    throw new Error('calculateWithdrawalFee: invalid feeBasisPoints');
  }

  // Integer division truncates, so the fee is rounded DOWN. Rounding therefore
  // never costs the user more than the published rate.
  const feeMinor = (grossMinor * BigInt(feeBasisPoints)) / BigInt(BASIS_POINTS_DENOMINATOR);

  return {
    grossMinor,
    feeMinor,
    netMinor: grossMinor - feeMinor,
    feeBasisPoints,
  };
}
