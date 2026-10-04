import type { MoneyState } from '@/components/ui/MoneyState';

/**
 * Presentation decisions for the paid-perk surface.
 *
 * Everything here is PURE and takes no I/O, so it is unit tested directly. It decides
 * how to DESCRIBE database state; it never decides financial state, and it never
 * computes an amount.
 */

// -----------------------------------------------------------------------------
// Order status
// -----------------------------------------------------------------------------

export type OrderTone = 'neutral' | 'brand' | 'warning' | 'danger';

// EVERY value of `app.paid_order_status`. Kept here so a test can assert the display
// map covers the real enum and invents nothing.
//
// THE VALUE THAT MATTERS: there is no `PAID`. The states are PENDING, CONFIRMED,
// FULFILLED, REFUNDED, CANCELLED. An earlier draft of this file mapped `PAID` to the
// brand tone, which does not exist as a status, so every genuinely paid order would
// have missed the map, fallen through to the fail-closed branch, and rendered in
// neutral grey reading "status: confirmed". Paid money would have been displayed as
// unpaid. This is the same defect as mapping `reward.state === 'SETTLED'` in CR-0027:
// comparing a presentation word against a database enum that does not contain it.
export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'FULFILLED',
  'REFUNDED',
  'CANCELLED',
] as const;

const ORDER_STATUS: Record<string, { tone: OrderTone; copy: string }> = {
  // PENDING is an intent to pay. It must never read as a purchase, because no money
  // has moved - that is law 47, and it is the single easiest thing to get wrong here.
  PENDING: { tone: 'warning', copy: 'Awaiting payment. No money has been taken yet.' },
  // CONFIRMED is the state `purchase_with_funding` leaves behind: the debit posted.
  CONFIRMED: { tone: 'brand', copy: 'Paid from your User Funding Balance.' },
  FULFILLED: { tone: 'brand', copy: 'Paid and active on your account.' },
  CANCELLED: { tone: 'neutral', copy: 'Cancelled. Nothing was paid.' },
  REFUNDED: { tone: 'danger', copy: 'Refunded. The money was returned to you.' },
};

export function describeOrderStatus(status: string): { tone: OrderTone; copy: string } {
  // Fail closed on an unknown status: "Awaiting payment" would be a claim about money
  // that the database has not made.
  return (
    ORDER_STATUS[status] ?? {
      tone: 'neutral',
      copy: `Status: ${status.toLowerCase()}. Contact support if this looks wrong.`,
    }
  );
}

/** Whether the order can still be acted on by its owner. */
export function isPayable(status: string): boolean {
  return status === 'PENDING';
}

export function isCancellable(status: string): boolean {
  return status === 'PENDING';
}

// -----------------------------------------------------------------------------
// Entitlement status
// -----------------------------------------------------------------------------

/**
 * An entitlement is NOT money and carries NO reward state.
 *
 * There is no `reward_state` here and there must not be: a perk is a purchased
 * capability, not a balance. Mapping it through `MoneyState` would let a "pending"
 * perk be described in the vocabulary of a pending CREDIT, which is the confusion
 * doc 83 STRICT BOUNDARY exists to prevent.
 */
export function entitlementTone(status: string): 'brand' | 'neutral' | 'danger' {
  if (status === 'ACTIVE') return 'brand';
  // ACTIVE, REVOKED, EXPIRED, CANCELLED - the complete enum.
  if (status === 'REVOKED' || status === 'EXPIRED' || status === 'CANCELLED') return 'danger';
  return 'neutral';
}

// -----------------------------------------------------------------------------
// Spend purposes
// -----------------------------------------------------------------------------

// `app.funding_spend_purpose` has exactly THREE values. There is no PERK_REFUND: a
// refund reuses PERK_PURCHASE with `is_refund = true`, so direction is read from that
// flag and not from the purpose. Naming a purpose that does not exist would suggest
// refunds are a separate kind of transaction, which they are not.
const SPEND_PURPOSE: Record<string, string> = {
  PERK_PURCHASE: 'Perk purchase',
  DONATION_FROM_FUNDING: 'Donation',
  // Modelled by the schema, deliberately unreachable: no game purchase path exists.
  GAME_PURCHASE: 'In-game purchase',
};

export function describeSpendPurpose(purpose: string): string {
  return SPEND_PURPOSE[purpose] ?? purpose.toLowerCase().replace(/_/g, ' ');
}

// -----------------------------------------------------------------------------
// Subscription honesty
// -----------------------------------------------------------------------------

/**
 * What to say about `billingPeriod`.
 *
 * Doc 83 SUBSCRIPTIONS is modelled - `billing_period` and `duration_seconds` exist on
 * the product - but NOTHING renews a subscription. There is no scheduler in this
 * project (docs 60/61/62 unstarted) and no recurring-billing path, because renewal is
 * a money path and would need its own authority and its own idempotency.
 *
 * So a product carrying a billing period must NOT be presented as recurring. Saying
 * "billed monthly" would be a promise the system cannot keep, and the user would
 * discover it by being charged unexpectedly. The copy below describes what is
 * actually true today: a one-off purchase of a period of access.
 */
export function describeBilling(billingPeriod: string | null): {
  recurring: boolean;
  copy: string;
} {
  if (!billingPeriod || billingPeriod === 'ONE_TIME') {
    return { recurring: false, copy: 'One-off purchase.' };
  }

  return {
    recurring: false,
    copy:
      `This grants a fixed period of access. It does NOT renew automatically and you will ` +
      `not be charged again for it. (The catalogue marks it "${billingPeriod.toLowerCase()}", ` +
      `but recurring billing is not implemented, so nothing will bill you.)`,
  };
}

/**
 * A recurring duration in seconds, as human text.
 *
 * Used only for the ACCESS PERIOD, never as a charge frequency.
 */
export function describeDuration(durationSeconds: number | null): string | null {
  if (!durationSeconds || durationSeconds <= 0) return null;

  const days = Math.round(durationSeconds / 86400);

  if (days >= 365) {
    const years = days / 365;
    return years === 1 ? '1 year' : `${Number(years.toFixed(1))} years`;
  }

  if (days >= 30) {
    const months = days / 30;
    return months === 1 ? '1 month' : `${Number(months.toFixed(1))} months`;
  }

  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;

  const hours = Math.round(durationSeconds / 3600);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/**
 * A perk's price display string.
 *
 * Raw minor units plus the unit, matching the dashboard, wallet and referrals pages.
 * The minor-unit scale is configuration, so this does not rescale speculatively.
 */
export function formatPrice(minor: number, unit: string): string {
  return `${minor.toLocaleString('en-US')} minor units (${unit})`;
}

/**
 * The money state of a funding SPEND.
 *
 * A debit spends User Funding Balance; a refund credits it back. Neither is an
 * earned reward. `MoneyState` is used only to make the direction unambiguous, never
 * to imply the amount is an available balance.
 */
export function spendTone(isRefund: boolean): MoneyState {
  return isRefund ? 'eligible' : 'reserved';
}
