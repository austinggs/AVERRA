import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_STATUSES,
  PAYMENT_SETTLEMENT_STATUSES,
  RECONCILIATION_STATUSES,
  REWARD_STATES,
  WITHDRAWAL_STATUSES,
  canTransitionDeposit,
  canTransitionWithdrawal,
  isDepositCreditable,
  isWithdrawalTerminal,
} from '@/lib/contracts/states';

describe('deposit lifecycle', () => {
  it('treats only CONFIRMED as creditable', () => {
    for (const status of DEPOSIT_STATUSES) {
      expect(isDepositCreditable(status)).toBe(status === 'CONFIRMED');
    }
  });

  it('has no path from PENDING straight to CONFIRMED', () => {
    expect(canTransitionDeposit('PENDING', 'CONFIRMED')).toBe(false);
  });

  it('requires verification before confirmation', () => {
    expect(canTransitionDeposit('SUBMITTED', 'VERIFIED')).toBe(true);
    expect(canTransitionDeposit('VERIFIED', 'CONFIRMED')).toBe(true);
  });

  it('routes unsupported or ambiguous cases to NEEDS_REVIEW', () => {
    expect(canTransitionDeposit('SUBMITTED', 'NEEDS_REVIEW')).toBe(true);
    expect(canTransitionDeposit('NEEDS_REVIEW', 'CONFIRMED')).toBe(true);
    expect(canTransitionDeposit('NEEDS_REVIEW', 'REJECTED')).toBe(true);
  });

  it('keeps a late payment reviewable after expiry instead of discarding it', () => {
    expect(canTransitionDeposit('EXPIRED', 'NEEDS_REVIEW')).toBe(true);
    expect(canTransitionDeposit('EXPIRED', 'CONFIRMED')).toBe(false);
  });
});

describe('withdrawal lifecycle', () => {
  it('never lets APPROVED jump straight to COMPLETED', () => {
    expect(canTransitionWithdrawal('APPROVED', 'COMPLETED')).toBe(false);
    expect(canTransitionWithdrawal('CONFIRMED', 'COMPLETED')).toBe(true);
  });

  it('runs the approved happy path in order', () => {
    const path = [
      'REQUESTED',
      'ELIGIBILITY_CHECKED',
      'RISK_REVIEW',
      'APPROVED',
      'PROCESSING',
      'PAYMENT_INITIATED',
      'CONFIRMED',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionWithdrawal(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('identifies terminal states', () => {
    expect(isWithdrawalTerminal('COMPLETED')).toBe(true);
    expect(isWithdrawalTerminal('PROCESSING')).toBe(false);
  });
});

describe('enum namespacing (the F-03 fix)', () => {
  it('retains every doc 37 token, including PAYMENT_INITIATED and COMPLETED', () => {
    expect(WITHDRAWAL_STATUSES).toContain('PAYMENT_INITIATED');
    expect(WITHDRAWAL_STATUSES).toContain('COMPLETED');
    expect(WITHDRAWAL_STATUSES).toContain('ELIGIBILITY_CHECKED');
  });

  it('moved SETTLEMENT and RECONCILED into their own lifecycles', () => {
    expect(WITHDRAWAL_STATUSES).not.toContain('SETTLEMENT');
    expect(WITHDRAWAL_STATUSES).not.toContain('RECONCILED');
    expect(PAYMENT_SETTLEMENT_STATUSES).toContain('SETTLED');
    expect(RECONCILIATION_STATUSES).toContain('MATCHED');
  });

  it('does not accept the un-suffixed ELIGIBILITY_CHECK token', () => {
    expect(WITHDRAWAL_STATUSES).not.toContain('ELIGIBILITY_CHECK');
  });

  it('keeps reward and withdrawal lifecycles as separate machines', () => {
    // Two independent machines. ELIGIBILITY_CHECKED is a withdrawal status; the
    // reward enum uses ELIGIBLE, so neither enum leaks a token into the other.
    // See Q-08 in docs/DISCREPANCIES.md.
    expect(REWARD_STATES).toContain('ON_HOLD');
    expect(WITHDRAWAL_STATUSES).toContain('ELIGIBILITY_CHECKED');
    expect(REWARD_STATES).not.toContain('RISK_REVIEW');
    expect(WITHDRAWAL_STATUSES).not.toContain('AVAILABLE');
  });

  it('mirrors doc 35 for the reward enum, not the coarser doc 05 prose', () => {
    // Doc 05 describes the flow narratively and names ELIGIBILITY_CHECKED, APPROVED
    // and WITHDRAWN. Doc 35 is the normative reward-engine states list and governs.
    expect(REWARD_STATES).toEqual([
      'ELIGIBLE',
      'PENDING',
      'AVAILABLE',
      'ON_HOLD',
      'REVERSED',
      'CHARGEBACK',
      'CANCELLED',
      'EXPIRED',
    ]);
  });
});
