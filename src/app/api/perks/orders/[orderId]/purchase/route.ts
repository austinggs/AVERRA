import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { createAdminClient } from '@/lib/supabase/admin';
import { findMyPerkOrder } from '@/lib/perks/reads';
import { errorFields } from '@/lib/observability/errors';

// POST /api/perks/orders/[orderId]/purchase
//
// THE ONLY ROUTE HERE THAT MOVES MONEY, and it debits USER FUNDING BALANCE - not
// Earned Reward Balance. That is the whole point of a paid perk: it is bought with
// deposited money, and the two balances never mix (law 56, doc 83 STRICT BOUNDARY).
//
// THE CLIENT SENDS AN ORDER ID AND NOTHING ELSE
//
// There is deliberately no amount and no unit in the request schema. Both are read
// back from the order the database priced from the catalogue. This is the property
// `create_paid_perk_order` was designed around - it has no amount parameter - and
// re-deriving the tendered figure server-side keeps it intact at the second step.
// Then `purchase_with_funding` independently re-reads the order AND the product and
// refuses if any of the three disagree. A tampered client amount cannot survive that,
// and it never had a field to tamper with.
//
// Two independent refunds guards are NOT here: `refund_funding_spend` takes an actor
// and is capability-gated. A user cancelling an unpaid order uses the cancel route;
// a refund is an operator action, so there is deliberately no user-facing refund
// route (doc 83 REFUNDS, law 42).

const purchaseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(async ({ user, params, body, correlationId }) => {
  const orderId = params.orderId;

  // Validated as a UUID rather than cast. An unvalidated path segment is attacker
  // input, and this value becomes a query argument.
  const parsedOrderId = z.string().uuid().safeParse(orderId);

  if (!parsedOrderId.success) {
    throw new RouteError('not_found', 'That order was not found.');
  }

  const orderUuid = parsedOrderId.data;

  const parsed = purchaseSchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Could not read that purchase request.',
      parsed.error.flatten().fieldErrors,
    );
  }

  // Scoped to the CALLER. `findMyPerkOrder` reads through `list_my_perk_orders`,
  // which filters on `p_user_id`, so another user's order reads as absent rather
  // than forbidden - a "forbidden" reply would confirm the id exists (doc 67 BOLA).
  const order = await findMyPerkOrder(user!.id, orderUuid);

  if (!order) {
    throw new RouteError('not_found', 'That order was not found.');
  }

  if (order.status !== 'PENDING') {
    throw new RouteError('invalid_request', `That order is already ${order.status.toLowerCase()}.`);
  }

  const idempotencyKeyValue = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'perk.order.purchase',
    provided: parsed.data.idempotencyKey,
    payload: { orderId: orderUuid },
  });

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('purchase_with_funding', {
    p_user_id: user!.id,
    p_purpose: 'PERK_PURCHASE',
    // SERVER-DERIVED, never from the request body.
    p_amount_minor: order.priceMinor.toString(),
    p_unit: order.unit,
    p_idempotency_key: idempotencyKeyValue,
    p_order_id: orderUuid,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    if (message.includes('insufficient')) {
      throw new RouteError(
        'insufficient_funds',
        'Your User Funding Balance is too low to cover this perk. Earned rewards cannot be used to buy perks.',
      );
    }

    if (message.includes('order is already')) {
      throw new RouteError('invalid_request', 'That order has already been paid.');
    }

    if (message.includes('an active entitlement for this product already exists')) {
      throw new RouteError('invalid_request', 'You already own this perk.');
    }

    if (message.includes('product is not available')) {
      throw new RouteError('invalid_request', 'That perk is no longer available.');
    }

    // A catalogue price that moved between order creation and payment. This is a real
    // state, and it must not be reported as a generic failure: the user has a PENDING
    // order they cannot pay, and they need to know to start a new one.
    if (message.includes('does not match the product catalogue')) {
      throw new RouteError(
        'invalid_request',
        'The price of that perk has changed. Cancel the order and start a new one.',
      );
    }

    console.error('[api] perk purchase failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not complete that purchase.');
  }

  const spend = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;

  // NO `status` IS RETURNED, AND THAT IS DELIBERATE.
  //
  // `purchase_with_funding` returns a `funding_spend_events` row, NOT the order, so
  // this handler has not read the order's resulting status and will not invent one.
  //
  // Measured against the live database, a successful purchase leaves the order in
  // FULFILLED. Two earlier drafts of this response returned `PAID` and then
  // `CONFIRMED`; neither is what the database says. Rather than hardcode a third
  // guess, the response reports only what was actually observed, and the client
  // `router.refresh()`es so the authoritative status is re-read from the server.
  //
  // This is the THIRD instance of one recurring defect in this codebase:
  // `reward.state === 'SETTLED'` in CR-0027, `paid_order_status.PAID` in the perk
  // display map, and now a fabricated response literal. The pattern is always the
  // same - a presentation word invented where a database value should be read.
  return NextResponse.json({
    purchased: true,
    spendId: spend?.id,
    orderId: order.id,
    order: {
      id: order.id,
      priceMinor: order.priceMinor.toString(),
      unit: order.unit,
    },
    // An entitlement now exists. It is not a reward and carries no reward state: a perk
    // is a purchased capability, not money in the user's pocket.
    entitlement: 'active',
    moneySource: 'USER_FUNDING',
    idempotencyKey: idempotencyKeyValue,
  });
});
