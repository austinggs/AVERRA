import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  describeBilling,
  describeDuration,
  describeOrderStatus,
  describeSpendPurpose,
  entitlementTone,
  formatPrice,
  isCancellable,
  isPayable,
  spendTone,
} from '@/lib/perks/present';

// LAW 47: creating an order moves NO money. The single most important thing this UI
// can get wrong is presenting a PENDING order as a purchase.
describe('describeOrderStatus', () => {
  it('never describes a PENDING order as paid', () => {
    const status = describeOrderStatus('PENDING');

    expect(status.tone).toBe('warning');
    expect(status.tone).not.toBe('brand');
    expect(status.copy).toMatch(/no money has been taken/i);
    expect(status.copy).not.toMatch(/active|purchased|paid\./i);
  });

  // The money has actually moved in these two, so they get the brand tone.
  it('gives CONFIRMED and FULFILLED the brand tone', () => {
    expect(describeOrderStatus('CONFIRMED').tone).toBe('brand');
    expect(describeOrderStatus('FULFILLED').tone).toBe('brand');
  });

  // A CANCELLED order had nothing paid, so it must not read as a refund either.
  it('describes CANCELLED as unpaid, not refunded', () => {
    const status = describeOrderStatus('CANCELLED');
    expect(status.tone).not.toBe('danger');
    expect(status.copy).not.toMatch(/refunded/i);
  });

  // Fail closed: an unknown status must not default to a money claim.
  it('fails closed on an unrecognised status', () => {
    expect(describeOrderStatus('WAT').tone).toBe('neutral');
    expect(describeOrderStatus('WAT').copy).toContain('wat');
  });
});

// THE ENUM AGREEMENT TEST.
//
// `app.paid_order_status` is PENDING, CONFIRMED, FULFILLED, REFUNDED, CANCELLED.
// There is NO `PAID`.
//
// An earlier draft mapped `PAID` to the brand tone. It does not exist, so the map
// missed, the fail-closed branch caught it, and every genuinely paid order rendered
// neutral grey reading "status: confirmed" - paid money displayed as unpaid. Exactly
// the CR-0027 `SETTLED` defect, one layer over.
//
// These two tests are the guard. The first pins the real enum so a new database state
// cannot appear unstyled. The second pins the bug itself, so reintroducing `PAID`
// fails loudly instead of quietly greying out a purchase.
describe('order status agrees with the database enum', () => {
  it('has an explicit display mapping for EVERY real status', () => {
    for (const status of ORDER_STATUSES) {
      const described = describeOrderStatus(status);

      // A missing mapping falls through to the generic copy, which contains the raw
      // status in lowercase. That is the tell.
      expect(described.copy).not.toContain(`status: ${status.toLowerCase()}`);
    }
  });

  it('has no invented statuses: PAID is not a database state', () => {
    // If someone "fixes" this to PAID, this fails.
    expect(ORDER_STATUSES).not.toContain('PAID');
    expect(describeOrderStatus('PAID').tone).not.toBe('brand');
  });

  it('keeps the enum list at exactly five values', () => {
    expect(ORDER_STATUSES).toHaveLength(5);
  });
});

describe('order actions', () => {
  it('only a PENDING order is payable', () => {
    expect(isPayable('PENDING')).toBe(true);
    expect(isPayable('CONFIRMED')).toBe(false);
    expect(isPayable('CANCELLED')).toBe(false);
    expect(isPayable('REFUNDED')).toBe(false);
  });

  // Cancelling is not refunding, so a paid order must not offer a cancel button.
  it('only a PENDING order is cancellable', () => {
    expect(isCancellable('PENDING')).toBe(true);
    expect(isCancellable('CONFIRMED')).toBe(false);
  });
});

// An entitlement is a purchased capability, not money.
describe('entitlementTone', () => {
  it('marks ACTIVE as the only positive state', () => {
    expect(entitlementTone('ACTIVE')).toBe('brand');
  });

  it('marks lapsed and revoked as not-currently-available', () => {
    expect(entitlementTone('EXPIRED')).toBe('danger');
    expect(entitlementTone('REVOKED')).toBe('danger');
  });

  it('is neutral for an unrecognised state', () => {
    expect(entitlementTone('MYSTERY')).toBe('neutral');
  });
});

// THE HONESTY TEST. Nothing renews a subscription in this project.
describe('describeBilling', () => {
  it('never claims a recurring charge', () => {
    for (const period of ['MONTHLY', 'YEARLY', 'WEEKLY']) {
      const billing = describeBilling(period);

      expect(billing.recurring).toBe(false);
      expect(billing.copy).not.toMatch(
        /renews automatically|billed monthly|each month|auto-renew/i,
      );
      // It must actually deny the recurring claim, not merely avoid making one.
      expect(billing.copy).toMatch(/does NOT renew/i);
      expect(billing.copy).toMatch(/recurring billing is not implemented/i);
    }
  });

  it('treats a one-off purchase as one-off', () => {
    expect(describeBilling('ONE_TIME').recurring).toBe(false);
    expect(describeBilling(null).copy).toMatch(/one-off/i);
  });
});

describe('describeDuration', () => {
  it('describes an access period, not a charge frequency', () => {
    expect(describeDuration(86400)).toBe('1 day');
    expect(describeDuration(2592000)).toBe('1 month');
    expect(describeDuration(31536000)).toBe('1 year');
  });

  it('returns null when there is no duration', () => {
    expect(describeDuration(null)).toBeNull();
    expect(describeDuration(0)).toBeNull();
  });
});

describe('describeSpendPurpose', () => {
  it('names the known purposes', () => {
    expect(describeSpendPurpose('PERK_PURCHASE')).toBe('Perk purchase');
    expect(describeSpendPurpose('DONATION_FROM_FUNDING')).toBe('Donation');
  });

  it('degrades readably for an unknown purpose', () => {
    expect(describeSpendPurpose('SOMETHING_NEW')).toBe('something new');
  });
});

// A refund is a CREDIT. Displaying it as another debit would make a refunded user
// look like they were charged twice.
describe('spendTone', () => {
  it('distinguishes a refund credit from a debit', () => {
    expect(spendTone(true)).toBe('eligible');
    expect(spendTone(false)).toBe('reserved');
  });

  // Neither may read as `settled`: a funding spend is never an available balance.
  it('never presents a spend as a settled available balance', () => {
    expect(spendTone(true)).not.toBe('settled');
    expect(spendTone(false)).not.toBe('settled');
  });
});

describe('formatPrice', () => {
  // The project renders raw minor units everywhere; a perk must match.
  it('does not rescale minor units', () => {
    expect(formatPrice(500000, 'NGN-kobo')).toContain('500,000');
    expect(formatPrice(500000, 'NGN-kobo')).not.toContain('5,000.00');
  });

  it('always states the unit', () => {
    expect(formatPrice(1000, 'NGN-kobo')).toContain('NGN-kobo');
  });
});
