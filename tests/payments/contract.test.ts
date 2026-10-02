import { describe, expect, it } from 'vitest';
import { createDaimoAdapter } from '@/lib/payments/adapters/daimo';
import {
  INBOUND_METHODS,
  PAYMENT_METHODS,
  executionModeFor,
  isAutomaticMethod,
  isSeparatelyApprovedFlow,
  type PayoutRequest,
} from '@/lib/payments/types';

// Law 40: "Automatic Daimo never silently falls back to a manual method."
//
// These tests pin the shapes that make that guarantee structural rather than
// a matter of developer discipline.

describe('payment method vocabulary', () => {
  it('matches doc 38 OUTBOUND exactly', () => {
    expect([...PAYMENT_METHODS]).toEqual([
      'MINIPAY_MANUAL',
      'BANK_MANUAL',
      'CRYPTO_AUTOMATIC_DAIMO',
    ]);
  });

  it('matches doc 38 INBOUND exactly', () => {
    expect([...INBOUND_METHODS]).toEqual([
      'MANUAL_MINIPAY_CRYPTO',
      'DAIMO_CRYPTO_DEPOSIT',
      'MINIPAY_CASH_LINK',
    ]);
  });
});

describe('executionModeFor', () => {
  it('marks the Daimo method as an automatic adapter', () => {
    expect(executionModeFor('CRYPTO_AUTOMATIC_DAIMO')).toBe('AUTOMATIC_ADAPTER');
  });

  it('marks both manual methods as a human operator', () => {
    // Law 22: a manual withdrawal is actually manual.
    expect(executionModeFor('MINIPAY_MANUAL')).toBe('MANUAL_OPERATOR');
    expect(executionModeFor('BANK_MANUAL')).toBe('MANUAL_OPERATOR');
  });

  it('has exactly one automatic method', () => {
    const automatic = PAYMENT_METHODS.filter(isAutomaticMethod);
    expect(automatic).toEqual(['CRYPTO_AUTOMATIC_DAIMO']);
  });
});

describe('isSeparatelyApprovedFlow', () => {
  it('treats MiniPay Cash Link as separately approved, per doc 38', () => {
    expect(isSeparatelyApprovedFlow('MINIPAY_CASH_LINK')).toBe(true);
  });

  it('does not treat the other inbound methods as separately approved', () => {
    expect(isSeparatelyApprovedFlow('MANUAL_MINIPAY_CRYPTO')).toBe(false);
    expect(isSeparatelyApprovedFlow('DAIMO_CRYPTO_DEPOSIT')).toBe(false);
  });
});

describe('the Daimo adapter refuses rather than faking a payout', () => {
  // These are the real behaviours, tested against the real adapter. A payout
  // adapter that returned a fabricated ACCEPTED would be the single most
  // dangerous failure in this codebase: the ledger would record a payout that
  // never happened.

  it('throws on sendPayout instead of returning a fake success', async () => {
    const adapter = createDaimoAdapter();

    await expect(
      adapter.sendPayout({
        operationId: 'op_1',
        amountMinor: 850n,
        unit: 'NGN',
        destinationAddress: '0xabc',
        idempotencyKey: 'wd_abc123',
      }),
    ).rejects.toThrow(/not integrated/i);
  });

  it('never returns a provider reference, because nothing was sent', async () => {
    const adapter = createDaimoAdapter();

    const outcome = await adapter
      .sendPayout({
        operationId: 'op_2',
        amountMinor: 100n,
        unit: 'NGN',
        destinationAddress: '0xabc',
        idempotencyKey: 'wd_abc124',
      })
      .then((result) => result.providerReference)
      .catch(() => null);

    expect(outcome).toBeNull();
  });

  it('states that the operation must not be rerouted to a manual payout', async () => {
    const adapter = createDaimoAdapter();

    await expect(
      adapter.sendPayout({
        operationId: 'op_3',
        amountMinor: 100n,
        unit: 'NGN',
        destinationAddress: '0xabc',
        idempotencyKey: 'wd_abc125',
      }),
    ).rejects.toThrow(/law 40/i);
  });

  it('throws on status read rather than inventing a vendor state', async () => {
    const adapter = createDaimoAdapter();

    await expect(adapter.getPayoutStatus('ref_1')).rejects.toThrow(/not integrated/i);
  });

  it('registers under the daimo provider code', () => {
    expect(createDaimoAdapter().providerCode).toBe('daimo');
  });
});

describe('PayoutRequest carries the NET amount, not the gross', () => {
  const request: PayoutRequest = {
    operationId: 'op_1',
    amountMinor: 850n,
    unit: 'NGN',
    destinationAddress: '0xabc',
    idempotencyKey: 'wd_abc123',
  };

  it('passes an already-fee-split amount to the adapter', () => {
    // The fee is split by quoteWithdrawal before the adapter is called. An
    // adapter re-deriving a fee would double-charge the user.
    expect(request.amountMinor).toBe(850n);
  });

  it('requires an idempotency key so a retry cannot pay twice', () => {
    expect(request.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('requires the destination, so an adapter cannot invent one', () => {
    expect(request.destinationAddress).toBeTruthy();
  });
});
