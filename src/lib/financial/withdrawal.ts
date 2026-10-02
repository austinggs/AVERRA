// Withdrawal economics and eligibility rules.
//
// Spec: 37_WITHDRAWAL_SYSTEM.txt (methods, fee disclosure, flow, states),
//       83_MONETIZATION_PAID_PERKS.md (15% fee and the required user notice),
//       71_ARCHITECTURAL_LAWS.md law 14 (withdrawal state is separate from
//       balance), law 22 (manual withdrawals are actually manual),
//       law 40 (automatic Daimo never silently falls back to a manual method).
//
// This module is the pure, testable mirror of the rules enforced by
// app_private.create_withdrawal_request in migration 007. It computes and
// validates; it never moves money. Money moves only through the database.

import { calculateWithdrawalFee, FEE_BASIS_POINTS } from '@/lib/financial/fee';

export const WITHDRAWAL_METHODS = [
  'MINIPAY_MANUAL',
  'BANK_MANUAL',
  'CRYPTO_AUTOMATIC_DAIMO',
] as const;
export type WithdrawalMethod = (typeof WITHDRAWAL_METHODS)[number];

/**
 * A manual method is performed by a named human operator. The automatic method
 * is performed by a provider adapter. There is no fourth option and no silent
 * fallback, which is law 40 expressed as a type.
 */
export function executionModeFor(
  method: WithdrawalMethod,
): 'MANUAL_OPERATOR' | 'AUTOMATIC_ADAPTER' {
  return method === 'CRYPTO_AUTOMATIC_DAIMO' ? 'AUTOMATIC_ADAPTER' : 'MANUAL_OPERATOR';
}

export function isManualMethod(method: WithdrawalMethod): boolean {
  return executionModeFor(method) === 'MANUAL_OPERATOR';
}

/** A manual payout destination must be verified before it can be used. */
export function destinationUsable(destinationStatus: string): boolean {
  return destinationStatus === 'VERIFIED';
}

export type WithdrawalQuote = {
  grossMinor: bigint;
  feeMinor: bigint;
  netMinor: bigint;
  feeBasisPoints: number;
  disclosure: string;
};

// The exact notice required by doc 83. Shown BEFORE the user confirms.
export const FEE_NOTICE =
  'Platform Service & Maintenance Fee: 15% of the gross withdrawal amount. ' +
  'This fee is retained by Averra as platform revenue to support maintaining, operating, ' +
  'securing, supporting, and developing the platform. Your net payout is the gross ' +
  'withdrawal amount minus this fee.';

export function quoteWithdrawal(
  grossMinor: bigint,
  feeBasisPoints: number = FEE_BASIS_POINTS,
): WithdrawalQuote {
  const fee = calculateWithdrawalFee(grossMinor, feeBasisPoints);
  return {
    grossMinor: fee.grossMinor,
    feeMinor: fee.feeMinor,
    netMinor: fee.netMinor,
    feeBasisPoints: fee.feeBasisPoints,
    disclosure: FEE_NOTICE,
  };
}

/**
 * The fee is taken FROM the gross amount, never added on top. This mirrors the
 * `withdrawal_requests_split_exact` database constraint, and it is why a user
 * requesting their full balance receives less than they hold.
 */
export function splitsExactly(quote: WithdrawalQuote): boolean {
  return quote.feeMinor + quote.netMinor === quote.grossMinor;
}

export type EligibilityResult =
  { ok: true } | { ok: false; code: WithdrawalIneligibleCode; message: string };

export type WithdrawalIneligibleCode =
  | 'BELOW_MINIMUM'
  | 'INSUFFICIENT_AVAILABLE_BALANCE'
  | 'DESTINATION_NOT_VERIFIED'
  | 'FUNDING_BALANCE_IS_NOT_WITHDRAWABLE';

export type EligibilityInput = {
  /** Available EARNED reward balance in minor units. */
  availableEarnedMinor: bigint;
  /** The user's User Funding Balance, which is deliberately NOT a source. */
  userFundingMinor: bigint;
  grossMinor: bigint;
  minimumMinor: bigint;
  destinationStatus: string;
  method: WithdrawalMethod;
};

/**
 * Eligibility. Note the deliberate absence of the User Funding Balance: a user
 * holding a large funding balance and a tiny earned balance is still ineligible,
 * because doc 37 states funding balance is not withdrawable by default.
 */
export function checkWithdrawalEligibility(input: EligibilityInput): EligibilityResult {
  if (input.grossMinor <= 0n) {
    return { ok: false, code: 'BELOW_MINIMUM', message: 'Withdrawal amount must be positive.' };
  }
  if (input.grossMinor < input.minimumMinor) {
    return {
      ok: false,
      code: 'BELOW_MINIMUM',
      message: `Minimum withdrawal is ${input.minimumMinor} minor units.`,
    };
  }
  if (!destinationUsable(input.destinationStatus)) {
    return {
      ok: false,
      code: 'DESTINATION_NOT_VERIFIED',
      message: 'The payout destination has not been verified.',
    };
  }
  if (input.availableEarnedMinor < input.grossMinor) {
    // The User Funding Balance is deliberately NOT consulted as a source of
    // funds. If it alone would have covered the request, say so explicitly, so
    // support can explain the rule rather than the user guessing at it.
    if (input.userFundingMinor >= input.grossMinor) {
      return {
        ok: false,
        code: 'FUNDING_BALANCE_IS_NOT_WITHDRAWABLE',
        message:
          'Your available earned reward balance is too low. User Funding Balance cannot be withdrawn.',
      };
    }
    return {
      ok: false,
      code: 'INSUFFICIENT_AVAILABLE_BALANCE',
      message: 'Insufficient available earned reward balance.',
    };
  }
  return { ok: true };
}
