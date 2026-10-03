-- =============================================================================
-- Averra migration 043: Paid perk order creation
--
-- Source of truth: 83_MONETIZATION_PAID_PERKS.md (MODEL, PAID PERKS, ENTITLEMENT
--                  MODEL, STRICT BOUNDARY, REFUNDS), 48_DATABASE_SCHEMA.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 42, 43, 44, 75_GAME_ECONOMY_FLOW.md
--
-- WHY THIS FILE EXISTS: THE PURCHASE PATH WAS DEAD CODE
--
-- Migration 041's `purchase_with_funding` opens with:
--
--     if p_purpose = 'PERK_PURCHASE' then
--       select * into v_order from app.paid_perk_orders where id = p_order_id;
--       if not found then
--         raise exception 'purchase_with_funding: unknown order'
--
-- and `app.paid_perk_orders` was NEVER INSERTED BY ANY MIGRATION. A search of all 42
-- migrations returns two references, both `update`: one in the fulfilment branch of
-- the purchase command and one in the refund command. There is no writer.
--
-- So every PERK_PURCHASE attempt raised `unknown order` before touching money. The
-- catalogue was listable, entitlements and spend history were readable, and no
-- purchase could ever succeed. This is the same failure shape as
-- `review_comment_media` in migration 038: a table fully specified and permanently
-- unreachable because nothing was ever written to it.
--
-- THE ONE RULE THAT MATTERS HERE
--
-- **The price is read from the catalogue, never from the caller.** The command
-- takes a product CODE, looks the product up, and copies `price_minor` and `unit`
-- off that row. There is deliberately no amount parameter, so there is nothing for
-- a client to tamper with. A second layer exists downstream: `purchase_with_funding`
-- independently re-reads the order, re-reads the product, and refuses if the two
-- disagree. Three checks for one number, none of which trusts the client.
--
-- LAW 47 SEPARATION
--
-- Creating an order moves NO MONEY. It writes a PENDING row and returns. The debit
-- is a separate command, on a separate call, that the user must confirm. An order
-- is an intent to pay, not a payment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_paid_perk_order: turns a product code into a PENDING order
-- -----------------------------------------------------------------------------
create or replace function app_private.create_paid_perk_order(
  p_user_id uuid,
  p_product_code text,
  p_idempotency_key text
)
returns app.paid_perk_orders
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.paid_perk_orders;
  v_product app.paid_perk_products;
  v_order app.paid_perk_orders;
begin
  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'create_paid_perk_order: a product code is required'
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'create_paid_perk_order: an idempotency key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- A retried request returns the original order rather than creating a second one.
  -- A double-tapped Buy button must not produce two orders.
  select * into v_existing from app.paid_perk_orders where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'create_paid_perk_order: idempotency key is already in use'
        using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  -- THE PRICE LOOKUP. Everything about the amount comes from this row.
  select * into v_product from app.paid_perk_products p where p.code = btrim(p_product_code);

  if not found then
    raise exception 'create_paid_perk_order: unknown product'
      using errcode = 'no_data_found';
  end if;

  if not v_product.is_active then
    -- A retired product is refused rather than created-and-failed-later, so the
    -- catalogue and the order flow cannot disagree about what is buyable.
    raise exception 'create_paid_perk_order: product % is not available', v_product.code
      using errcode = 'check_violation';
  end if;

  -- Refused EARLY, before any order row exists. `purchase_with_funding` re-checks
  -- this immediately before the debit; this copy only avoids creating an order that
  -- could never be paid.
  if exists (
    select 1 from app.paid_entitlements e
    where e.user_id = p_user_id
      and e.product_id = v_product.id
      and e.status = 'ACTIVE'
  ) then
    raise exception 'create_paid_perk_order: you already own this perk'
      using errcode = 'check_violation';
  end if;

  insert into app.paid_perk_orders (
    user_id, product_id, status, price_minor, unit, idempotency_key
  ) values (
    p_user_id, v_product.id, 'PENDING',
    v_product.price_minor, v_product.unit, p_idempotency_key
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function app_private.create_paid_perk_order(uuid, text, text) from public, anon, authenticated;
grant execute on function app_private.create_paid_perk_order(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- cancel_paid_perk_order: abandon an unpaid order
-- -----------------------------------------------------------------------------
-- Without this, every abandoned checkout leaves a PENDING row forever and
-- `idx_paid_perk_orders_status` fills with orders nobody intends to pay.
--
-- Refuses an already-fulfilled order, because cancelling a PAID order is a
-- REFUND, not a cancellation. Refunds go through `refund_funding_spend`, which
-- posts a compensating CREDIT and leaves the original debit untouched (law 42,
-- doc 83 REFUNDS). `paid_perk_orders_cancelled_has_no_spend` requires a CANCELLED
-- order to have no ledger entry, so the two paths cannot be confused.
create or replace function app_private.cancel_paid_perk_order(
  p_user_id uuid,
  p_order_id uuid
)
returns app.paid_perk_orders
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_order app.paid_perk_orders;
begin
  select * into v_order from app.paid_perk_orders o
  where o.id = p_order_id and o.user_id = p_user_id;

  if not found then
    raise exception 'cancel_paid_perk_order: unknown order'
      using errcode = 'no_data_found';
  end if;

  if v_order.status in ('FULFILLED', 'REFUNDED') then
    raise exception 'cancel_paid_perk_order: a paid order cannot be cancelled, it must be refunded'
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'CANCELLED' then
    return v_order;
  end if;

  update app.paid_perk_orders set status = 'CANCELLED' where id = p_order_id
  returning * into v_order;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'perk.order_cancelled', 'paid_perk_order', p_order_id::text, 'SUCCESS',
    jsonb_build_object('productId', v_order.product_id, 'status', v_order.status::text)
  );

  return v_order;
end;
$$;

revoke all on function app_private.cancel_paid_perk_order(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.cancel_paid_perk_order(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Public entry points and one read wrapper (the migration-035 pattern)
-- -----------------------------------------------------------------------------
-- PostgREST resolves an RPC only against an EXPOSED schema, and `app_private` is
-- deliberately not exposed. Each wrapper below is a thin same-signature delegate
-- that adds no logic, and each revokes `public, anon, authenticated` BEFORE
-- granting to `service_role` (the migration-036 lesson, Q-22).
create or replace function public.create_paid_perk_order(
  p_user_id uuid,
  p_product_code text,
  p_idempotency_key text
)
returns app.paid_perk_orders
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.create_paid_perk_order(p_user_id, p_product_code, p_idempotency_key);
$$;

revoke all on function public.create_paid_perk_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_paid_perk_order(uuid, text, text) to service_role;

create or replace function public.cancel_paid_perk_order(
  p_user_id uuid,
  p_order_id uuid
)
returns app.paid_perk_orders
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.cancel_paid_perk_order(p_user_id, p_order_id);
$$;

revoke all on function public.cancel_paid_perk_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_paid_perk_order(uuid, uuid) to service_role;

-- The caller's own orders, newest first. Scoped by p_user_id, which the route takes
-- from the verified session and never from the body.
--
-- No `funding_spend_entry_id` and no amounts beyond what the user already sees in
-- the catalogue: this wrapper exists so the UI can show order state, and a wrapper
-- too wide is how callers end up reading tables directly.
create or replace function public.list_my_perk_orders(
  p_user_id uuid,
  p_limit integer default 25
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', o.id,
    'productId', o.product_id,
    'productCode', p.code,
    'productName', p.name,
    'status', o.status,
    'priceMinor', o.price_minor,
    'unit', o.unit,
    'createdAt', o.created_at,
    'fulfilledAt', o.fulfilled_at,
    'refundedAt', o.refunded_at
  )
  from app.paid_perk_orders o
  join app.paid_perk_products p on p.id = o.product_id
  where o.user_id = p_user_id
  order by o.created_at desc
  limit least(coalesce(p_limit, 25), 100);
$$;

revoke all on function public.list_my_perk_orders(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_my_perk_orders(uuid, integer) to service_role;