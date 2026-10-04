import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPerkProducts, listMyPerkOrders, listMyEntitlements } from '@/lib/perks/reads';

// GET  /api/perks  the active catalogue with the caller's entitlement state
// POST /api/perks  create a PENDING order for a product CODE
//
// POST DOES NOT TAKE A PRICE. Doc 83 MODEL is catalogue-driven, and
// `create_paid_perk_order` has no amount parameter at all: it copies `price_minor`
// and `unit` off the product row. Passing a price from the client would be the one
// thing that could make the displayed figure differ from the charged figure, so the
// schema here simply has no field for one.
//
// LAW 47 SEPARATION: creating an order moves NO money. It writes a PENDING row. The
// debit is `POST /api/perks/orders/[orderId]/purchase`, a separate call the user
// confirms. An order is an intent to pay, not a payment.

export const GET = route(async ({ user }) => {
  const [products, orders, entitlements] = await Promise.all([
    listPerkProducts(user!.id),
    listMyPerkOrders(user!.id),
    listMyEntitlements(user!.id),
  ]);

  return NextResponse.json({ products, orders, entitlements });
});

const createOrderSchema = z.object({
  // Matches `paid_perk_products_code_shape` exactly: ^[a-z0-9_]{2,60}$. Validated at
  // the edge so a bad code is a clear message here rather than a raw 23514 from the
  // catalogue lookup. The bound is 60, not 64, because that is the constraint.
  productCode: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Perk codes are lowercase letters, numbers and underscores.'),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = createOrderSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Choose a perk from the catalogue.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { productCode, idempotencyKey } = parsed.data;

  const idempotencyKeyValue = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'perk.order.create',
    provided: idempotencyKey,
    payload: { productCode },
  });

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('create_paid_perk_order', {
    p_user_id: user!.id,
    p_product_code: productCode,
    p_idempotency_key: idempotencyKeyValue,
  });

  if (error) {
    const message = error.message;

    if (message.includes('unknown product')) {
      throw new RouteError('not_found', 'That perk is not in the catalogue.');
    }

    if (message.includes('is not available')) {
      throw new RouteError('invalid_request', 'That perk is not currently available.');
    }

    if (message.includes('you already own this perk')) {
      throw new RouteError('invalid_request', 'You already own this perk.');
    }

    if (message.includes('idempotency key is already in use')) {
      throw new RouteError('invalid_request', 'That request was already submitted.');
    }

    console.error('[api] create perk order failed', { correlationId, error: message });
    throw new RouteError('internal_error', 'Could not start that purchase.');
  }

  const order = (Array.isArray(data) ? data[0] : data) as {
    id?: string;
    status?: string;
    price_minor?: number | string;
    unit?: string;
  } | null;

  return NextResponse.json(
    {
      order: {
        id: order?.id,
        status: order?.status,
        // Echoed from the order row the database priced, not from the request, so the
        // confirmation step can show exactly what will be charged.
        priceMinor: order?.price_minor?.toString(),
        unit: order?.unit,
      },
      // Explicit, so a caller cannot mistake a PENDING order for a completed payment.
      moneyMoved: false,
      nextStep: 'POST /api/perks/orders/{id}/purchase to confirm and pay',
    },
    { status: 201 },
  );
});
