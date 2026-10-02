import { describe, expect, it } from 'vitest';
import { FEE_BASIS_POINTS } from '@/lib/financial/fee';
import {
  FEE_NOTICE,
  WITHDRAWAL_METHODS,
  checkWithdrawalEligibility,
  destinationUsable,
  executionModeFor,
  isManualMethod,
  quoteWithdrawal,
  splitsExactly,
} from '@/lib/financial/withdrawal';

const MIN = 1000n;

describe('withdrawal methods and execution mode', () => {
  it('exposes exactly the three approved methods', () => {
    expect([...WITHDRAWAL_METHODS]).toEqual([
      'MINIPAY_MANUAL',
      'BANK_MANUAL',
      'CRYPTO_AUTOMATIC_DAIMO',
    ]);
  });

  it('treats only the Daimo method as automatic (law 40, no silent fallback)', () => {
    expect(executionModeFor('CRYPTO_AUTOMATIC_DAIMO')).toBe('AUTOMATIC_ADAPTER');
    expect(executionModeFor('MINIPAY_MANUAL')).toBe('MANUAL_OPERATOR');
    expect(executionModeFor('BANK_MANUAL')).toBe('MANUAL_OPERATOR');
  });

  it('keeps manual methods manual (law 22)', () => {
    expect(isManualMethod('MINIPAY_MANUAL')).toBe(true);
    expect(isManualMethod('BANK_MANUAL')).toBe(true);
    expect(isManualMethod('CRYPTO_AUTOMATIC_DAIMO')).toBe(false);
  });
});

describe('fee disclosure (law 45)', () => {
  it('takes the fee from the gross amount, never adds to it', () => {
    // 1000 gross -> 150 fee -> 850 net. This is the doc 83 worked example.
    const quote = quoteWithdrawal(1000n);
    expect(quote.grossMinor).toBe(1000n);
    expect(quote.feeMinor).toBe(150n);
    expect(quote.netMinor).toBe(850n);
    expect(FEE_BASIS_POINTS).toBe(1500);
  });

  it('always splits exactly, mirroring the database constraint', () => {
    for (const gross of [0n, 1n, 7n, 99n, 100n, 1000n, 123456n, 999_999_999n]) {
      expect(splitsExactly(quoteWithdrawal(gross))).toBe(true);
    }
  });

  it('never rounds the fee up above the published rate', () => {
    // 999 * 15% = 149.85, truncated to 149. The user is never overcharged.
    expect(quoteWithdrawal(999n).feeMinor).toBe(149n);
  });

  it('carries the required user notice verbatim', () => {
    const quote = quoteWithdrawal(1000n);
    expect(quote.disclosure).toBe(FEE_NOTICE);
    expect(quote.disclosure).toContain('15%');
    expect(quote.disclosure).toContain('net payout');
  });
});

describe('destination verification (law 23)', () => {
  it('accepts only a verified destination', () => {
    expect(destinationUsable('VERIFIED')).toBe(true);
    for (const status of ['PENDING_VERIFICATION', 'REJECTED', 'REVOKED', 'unknown']) {
      expect(destinationUsable(status)).toBe(false);
    }
  });
});

describe('eligibility', () => {
  const base = {
    availableEarnedMinor: 10_000n,
    userFundingMinor: 0n,
    grossMinor: 1_000n,
    minimumMinor: MIN,
    destinationStatus: 'VERIFIED',
    method: 'MINIPAY_MANUAL',
  } as const;

  it('accepts a request within the available earned balance', () => {
    expect(checkWithdrawalEligibility(base)).toEqual({ ok: true });
  });

  it('rejects an amount below the configured minimum', () => {
    const result = checkWithdrawalEligibility({ ...base, grossMinor: MIN - 1n });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('BELOW_MINIMUM');
  });

  it('rejects a non-positive amount', () => {
    const result = checkWithdrawalEligibility({ ...base, grossMinor: 0n });
    expect(result.ok === false && result.code).toBe('BELOW_MINIMUM');
  });

  it('rejects an unverified destination regardless of balance', () => {
    const result = checkWithdrawalEligibility({
      ...base,
      destinationStatus: 'PENDING_VERIFICATION',
    });
    expect(result.ok === false && result.code).toBe('DESTINATION_NOT_VERIFIED');
  });

  it('reports insufficient earned balance', () => {
    const result = checkWithdrawalEligibility({ ...base, grossMinor: 20_000n });
    expect(result.ok === false && result.code).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
  });

  it('never treats User Funding Balance as withdrawable (doc 37, law 42)', () => {
    // The user funded 50,000 but has earned only 100. Still ineligible, and the
    // reason names the rule instead of silently reporting a generic shortfall.
    const result = checkWithdrawalEligibility({
      ...base,
      availableEarnedMinor: 100n,
      userFundingMinor: 50_000n,
      grossMinor: 1_000n,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('FUNDING_BALANCE_IS_NOT_WITHDRAWABLE');
  });

  it('allows a user holding both balances to withdraw the earned portion', () => {
    const result = checkWithdrawalEligibility({
      ...base,
      availableEarnedMinor: 5_000n,
      userFundingMinor: 50_000n,
      grossMinor: 1_000n,
    });
    expect(result).toEqual({ ok: true });
  });
});
