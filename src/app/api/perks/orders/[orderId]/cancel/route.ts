import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// POST /api/perks/orders/[orderId]/cancel
//
// Abandons an UNPAID order. Without this, every abandoned checkout leaves a PENDING
// row forever.
//
// THIS IS NOT A REFUND, and the distinction is structural rather than cosmetic.
// `cancel_paid_perk_order` refuses any order that is not PENDING, so a PAID order
// cannot be cancelled here - cancelling one would erase the fact that money moved.
// A refund is a compensating CREDIT posted by `refund_funding_spend`, which is
// actor-gated and has no user-facing route. `paid_perk_orders_cancelled_has_no_spend`
// requires a CANCELLED order to have no ledger entry, so the two paths cannot be
// confused by a caller.

export const POST = route(async ({ user, params, correlationId }) => {
  const orderId = params.orderId;
  const admin = createAdminClient();

  const { error } = await admin.rpc('cancel_paid_perk_order', {
    p_user_id: user!.id,
    p_order_id: orderId,
  });

  if (error) {
    const message = error.message;

    // Both a wrong-owner order and an unknown order report "not found". Revealing
    // which would confirm the id exists to someone who does not own it (doc 67 BOLA).
    if (message.includes('order not found') || message.includes('does not belong')) {
      throw new RouteError('not_found', 'That order was not found.');
    }

    if (message.includes('cannot be cancelled')) {
      throw new RouteError(
        'invalid_request',
        'That order has already been paid, so it cannot be cancelled. Contact support.',
      );
    }

    console.error('[api] cancel perk order failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not cancel that order.');
  }

  return NextResponse.json({
    cancelled: true,
    orderId,
    // Said plainly, because "cancelled" reads like a refund to most people and this
    // one is not one.
    refunded: false,
    message:
      'Order cancelled. No money was taken, because nothing had been paid yet. If you were ' +
      'charged, contact support.',
  });
});
