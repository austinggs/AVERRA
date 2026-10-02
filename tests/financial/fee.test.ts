import { describe, expect, it } from 'vitest';
import {
  BASIS_POINTS_DENOMINATOR,
  FEE_BASIS_POINTS,
  calculateWithdrawalFee,
} from '@/lib/financial/fee';

describe('withdrawal service fee', () => {
  it('reproduces the documented example: 1000 gross -> 150 fee -> 850 net', () => {
    const r = calculateWithdrawalFee(100_000n);
    expect(r.feeMinor).toBe(15_000n);
    expect(r.netMinor).toBe(85_000n);
  });

  it('uses the baseline rate of 15%', () => {
    expect(FEE_BASIS_POINTS).toBe(1500);
    expect(BASIS_POINTS_DENOMINATOR).toBe(10_000);
  });

  it('always satisfies fee + net == gross', () => {
    for (const gross of [0n, 1n, 7n, 999n, 100_000n, 12_345_678n]) {
      const r = calculateWithdrawalFee(gross);
      expect(r.feeMinor + r.netMinor).toBe(gross);
    }
  });

  it('rounds the fee down so rounding never charges above the published rate', () => {
    // 1 minor unit gross: 15% is 0.15 minor units, which must not become 1.
    expect(calculateWithdrawalFee(1n).feeMinor).toBe(0n);
    expect(calculateWithdrawalFee(9n).feeMinor).toBe(1n);
  });

  it('is zero for a zero gross', () => {
    const r = calculateWithdrawalFee(0n);
    expect(r.feeMinor).toBe(0n);
    expect(r.netMinor).toBe(0n);
  });

  it('never returns a negative net', () => {
    const r = calculateWithdrawalFee(100n);
    expect(r.netMinor).toBeGreaterThanOrEqual(0n);
  });

  it('rejects a negative gross', () => {
    expect(() => calculateWithdrawalFee(-1n)).toThrow();
  });

  it('rejects an out-of-range or non-integer fee basis', () => {
    expect(() => calculateWithdrawalFee(100n, -1)).toThrow();
    expect(() => calculateWithdrawalFee(100n, 10_001)).toThrow();
    expect(() => calculateWithdrawalFee(100n, 12.5)).toThrow();
  });
});
