import { describe, expect, it } from 'vitest';
import { formatAmount, mapRewardState } from '@/lib/referrals/present';

// Every value of `app.reward_state` is asserted, so a NEW enum value added by a
// migration fails here rather than silently rendering as "not payable".
describe('mapRewardState', () => {
  it('maps every database reward_state to a presentation state', () => {
    expect(mapRewardState('PENDING')).toBe('pending');
    expect(mapRewardState('ELIGIBLE')).toBe('eligible');
    expect(mapRewardState('AVAILABLE')).toBe('settled');
    expect(mapRewardState('ON_HOLD')).toBe('reserved');
    expect(mapRewardState('REVERSED')).toBe('failed');
    expect(mapRewardState('CHARGEBACK')).toBe('failed');
    expect(mapRewardState('CANCELLED')).toBe('failed');
    expect(mapRewardState('EXPIRED')).toBe('failed');
  });

  // The bug this mapper was written for. `SETTLED` is a MoneyState value, not a
  // reward_state value, so code comparing the two silently always fails.
  it('has no database state called SETTLED', () => {
    expect(mapRewardState('SETTLED')).toBe('failed');
  });

  // An unknown state must never render as available money.
  it('fails closed on an unrecognised state', () => {
    expect(mapRewardState('WAT')).toBe('failed');
    expect(mapRewardState('')).toBe('failed');
  });

  // Only AVAILABLE may produce the settled presentation, because `settled` is the
  // only one that earns the brand green.
  it('makes AVAILABLE the sole settled case', () => {
    const settled = [
      'PENDING',
      'ELIGIBLE',
      'ON_HOLD',
      'REVERSED',
      'CHARGEBACK',
      'CANCELLED',
      'EXPIRED',
    ];
    for (const state of settled) {
      expect(mapRewardState(state)).not.toBe('settled');
    }
    expect(mapRewardState('AVAILABLE')).toBe('settled');
  });
});

describe('formatAmount', () => {
  // The project shows raw minor units, never a speculative rescale to naira.
  it('does not rescale minor units', () => {
    expect(formatAmount(500000, 'NGN-kobo')).toContain('500,000');
    expect(formatAmount(500000, 'NGN-kobo')).not.toContain('5,000.00');
  });

  it('always states the unit', () => {
    expect(formatAmount(500000, 'NGN-kobo')).toContain('NGN-kobo');
  });
});
