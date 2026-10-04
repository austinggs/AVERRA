import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// Server-side reads for the paid-perk surface (doc 83).
//
// EVERY READ GOES THROUGH A `public` WRAPPER. The `app` schema is not exposed through
// the Data API, so `.from('paid_perk_products')` would fail with PGRST205 even with
// every migration applied. `npm run check:data-api` enforces that; the fix for a
// missing read is a wrapper, never a suppression.

export type PerkProduct = {
  id: string;
  code: string;
  kind: string;
  name: string;
  description: string | null;
  priceMinor: number;
  unit: string;
  billingPeriod: string | null;
  /** Present because the schema models subscriptions. NOTHING renews one yet. */
  durationSeconds: number | null;
  isActive: boolean;
  /** Whether the CALLER already holds an active entitlement. Server-computed. */
  owned: boolean;
};

export type PerkOrder = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  status: string;
  priceMinor: number;
  unit: string;
  createdAt: string;
  fulfilledAt: string | null;
  refundedAt: string | null;
};

export type PerkEntitlement = {
  id: string;
  productCode: string;
  productName: string;
  kind: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type FundingSpend = {
  id: string;
  purpose: string;
  amountMinor: number;
  unit: string;
  /** A compensating CREDIT from a refund, not a new debit. */
  isRefund: boolean;
  createdAt: string;
};

function num(value: unknown): number {
  // bigint columns arrive as JSON numbers, but a value beyond 2^53 would already be
  // wrong by then. Coercing through Number here only normalises the transport type;
  // the authoritative figure is the integer the database holds.
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/** The active catalogue, with `owned` resolved per caller. */
export async function listPerkProducts(userId: string): Promise<PerkProduct[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('list_perk_products', {
    p_user_id: userId,
    p_limit: 50,
  });

  if (error) throw new Error(`list_perk_products failed: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    kind: String(row.kind),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    priceMinor: num(row.priceMinor),
    unit: String(row.unit ?? ''),
    billingPeriod: (row.billingPeriod as string | null) ?? null,
    durationSeconds:
      row.durationSeconds === null || row.durationSeconds === undefined
        ? null
        : num(row.durationSeconds),
    isActive: Boolean(row.isActive),
    owned: Boolean(row.owned),
  }));
}

export async function listMyPerkOrders(userId: string): Promise<PerkOrder[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('list_my_perk_orders', {
    p_user_id: userId,
    p_limit: 25,
  });

  if (error) throw new Error(`list_my_perk_orders failed: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    productId: String(row.productId),
    productCode: String(row.productCode),
    productName: String(row.productName),
    status: String(row.status),
    priceMinor: num(row.priceMinor),
    unit: String(row.unit ?? ''),
    createdAt: String(row.createdAt),
    fulfilledAt: (row.fulfilledAt as string | null) ?? null,
    refundedAt: (row.refundedAt as string | null) ?? null,
  }));
}

export async function listMyEntitlements(userId: string): Promise<PerkEntitlement[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('list_my_entitlements', {
    p_user_id: userId,
    p_limit: 50,
  });

  if (error) throw new Error(`list_my_entitlements failed: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    productCode: String(row.productCode),
    productName: String(row.productName),
    kind: String(row.kind),
    status: String(row.status),
    startsAt: (row.startsAt as string | null) ?? null,
    endsAt: (row.endsAt as string | null) ?? null,
  }));
}

export async function listMyFundingSpends(userId: string): Promise<FundingSpend[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('list_my_funding_spends', {
    p_user_id: userId,
    p_limit: 50,
  });

  if (error) throw new Error(`list_my_funding_spends failed: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    purpose: String(row.purpose),
    amountMinor: num(row.amountMinor),
    unit: String(row.unit ?? ''),
    isRefund: Boolean(row.isRefund),
    createdAt: String(row.createdAt),
  }));
}

/**
 * Read ONE of the caller's orders, for the tender amount of a purchase.
 *
 * `purchase_with_funding` requires an amount and a unit. They are taken from HERE -
 * the order the database already priced from the catalogue - and never from the
 * request body. The client sends an order id and nothing else.
 *
 * That matters because `create_paid_perk_order` deliberately has no amount parameter:
 * the price comes from the catalogue, so there is nothing for a client to tamper with.
 * Re-deriving the tendered amount server-side keeps that property intact at the
 * second step, and `purchase_with_funding` then re-reads both the order and the
 * product and refuses if they disagree. Three independent checks for one number.
 */
export async function findMyPerkOrder(userId: string, orderId: string): Promise<PerkOrder | null> {
  const orders = await listMyPerkOrders(userId);
  return orders.find((order) => order.id === orderId) ?? null;
}
