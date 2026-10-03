-- =============================================================================
-- Averra migration 041: Funding-spend purchase commands and perk reads
--
-- Source of truth: 83_MONETIZATION_PAID_PERKS.md, 75_GAME_ECONOMY_FLOW.md,
--   36_WALLET_LEDGER.txt, 71_ARCHITECTURAL_LAWS.md laws 2, 42, 43, 56
--
-- Three layers, as in migration 039:
--   1. app_private commands - the only writers. Each validates ownership and
--      the state of the thing being written, because a route can be bypassed
--      and a function cannot.
--   2. public entry points  - thin same-signature delegates so PostgREST can
--      resolve the RPC (migration 035 pattern).
--   3. public read wrappers - deliberate projections, scoped by the session
--      user id, filtered BEFORE the cap, capped in SQL.
--
-- THE MONEY RULE, STATED ONCE
--
-- purchase_with_funding is the ONLY function in this subsystem that calls
-- post_ledger_entry, and it posts exactly one shape: a DEBIT against the
-- caller's USER_FUNDING account with source_type USER_FUNDING_SPEND. It can
-- never post REWARD_EARNED, never touch EARNED_REWARD, never credit anything.
-- record_donation posts NO ledger entry at all: recording a donation is
-- acknowledgement, not money movement. A funding-sourced donation still goes
-- through purchase_with_funding with purpose DONATION_FROM_FUNDING, so the
-- debit is explicit and audited rather than a side effect.
-- =============================================================================

-- Posts the single authorised debit shape. Internal: only called by
-- purchase_with_funding below, after every validation has passed.
create or replace function app_private.post_funding_spend_debit(
  p_user_id uuid,
  p_amount_minor bigint,
  p_unit text,
  p_source_id text,
  p_idempotency_key text,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns app.ledger_entries
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_funding uuid;
  v_entry app.ledger_entries;
begin
  select id into v_funding
  from app.ledger_accounts
  where user_id = p_user_id and domain = 'USER_FUNDING' and unit = p_unit;

  if not found then
    raise exception 'post_funding_spend_debit: no user funding account for this user and unit'
      using errcode = 'foreign_key_violation';
  end if;

  -- DEBIT against USER_FUNDING with USER_FUNDING_SPEND. Never REWARD_EARNED,
  -- never EARNED_REWARD, never a CREDIT. post_ledger_entry itself refuses a
  -- debit that would take a user-facing balance negative (law 1).
  v_entry := app_private.post_ledger_entry(
    v_funding, 'DEBIT', p_amount_minor, p_unit,
    'USER_FUNDING_SPEND', p_source_id,
    p_idempotency_key, p_correlation_id, p_metadata
  );

  return v_entry;
end;
$$;

revoke all on function app_private.post_funding_spend_debit(uuid, bigint, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function app_private.post_funding_spend_debit(uuid, bigint, text, text, text, uuid, jsonb) to service_role;
-- Doc 75 USER FUNDING INTEGRATION + doc 83 purchase path. Verifies available
-- funding, posts the USER_FUNDING_SPEND debit, then grants the matching
-- entitlement or resource. One transaction: money and entitlement move
-- together or not at all. Idempotent on p_idempotency_key.
create or replace function app_private.purchase_with_funding(
  p_user_id uuid,
  p_purpose app.funding_spend_purpose,
  p_amount_minor bigint,
  p_unit text,
  p_idempotency_key text,
  p_game_target_code text default null,
  p_order_id uuid default null,
  p_donation_id uuid default null,
  p_correlation_id uuid default null
) returns app.funding_spend_events
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.funding_spend_events;
  v_entry app.ledger_entries;
  v_order app.paid_perk_orders;
  v_product app.paid_perk_products;
  v_donation app.donations;
  v_spend app.funding_spend_events;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'purchase_with_funding: amount must be positive'
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'purchase_with_funding: an idempotency key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_existing
  from app.funding_spend_events where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  if p_purpose = 'GAME_PURCHASE' and (p_game_target_code is null
      or p_order_id is not null or p_donation_id is not null) then
    raise exception 'purchase_with_funding: GAME_PURCHASE needs only a game target code'
      using errcode = 'check_violation';
  end if;
  if p_purpose = 'PERK_PURCHASE' and (p_order_id is null
      or p_game_target_code is not null or p_donation_id is not null) then
    raise exception 'purchase_with_funding: PERK_PURCHASE needs only an order id'
      using errcode = 'check_violation';
  end if;
  if p_purpose = 'DONATION_FROM_FUNDING' and (p_donation_id is null
      or p_game_target_code is not null or p_order_id is not null) then
    raise exception 'purchase_with_funding: DONATION_FROM_FUNDING needs only a donation id'
      using errcode = 'check_violation';
  end if;

  if p_purpose = 'PERK_PURCHASE' then
    select * into v_order from app.paid_perk_orders where id = p_order_id for update;
    if not found then
      raise exception 'purchase_with_funding: unknown order'
        using errcode = 'foreign_key_violation';
    end if;
    if v_order.user_id <> p_user_id then
      raise exception 'purchase_with_funding: order does not belong to this user'
        using errcode = 'foreign_key_violation';
    end if;
    if v_order.status <> 'PENDING' then
      raise exception 'purchase_with_funding: order is already %', v_order.status
        using errcode = 'check_violation';
    end if;
    select * into v_product from app.paid_perk_products where id = v_order.product_id;
    if not found or not v_product.is_active then
      raise exception 'purchase_with_funding: product is not available'
        using errcode = 'check_violation';
    end if;
    if v_order.price_minor <> v_product.price_minor
        or v_order.unit <> v_product.unit then
      raise exception 'purchase_with_funding: order price does not match the product catalogue'
        using errcode = 'check_violation';
    end if;
    if p_amount_minor <> v_order.price_minor or p_unit <> v_order.unit then
      raise exception 'purchase_with_funding: tendered amount does not match the order price'
        using errcode = 'check_violation';
    end if;
    -- One live entitlement per product per user. Checked BEFORE the debit so
    -- a duplicate purchase is refused without moving money (the unique index
    -- uq_paid_entitlements_active remains as the structural backstop).
    if exists (
      select 1 from app.paid_entitlements
      where user_id = p_user_id and product_id = v_order.product_id
        and status = 'ACTIVE'
    ) then
      raise exception 'purchase_with_funding: an active entitlement for this product already exists'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_purpose = 'DONATION_FROM_FUNDING' then
    select * into v_donation from app.donations where id = p_donation_id for update;
    if not found then
      raise exception 'purchase_with_funding: unknown donation'
        using errcode = 'foreign_key_violation';
    end if;
    if v_donation.user_id <> p_user_id then
      raise exception 'purchase_with_funding: donation does not belong to this user'
        using errcode = 'foreign_key_violation';
    end if;
    if v_donation.funding_source <> 'USER_FUNDING' then
      raise exception 'purchase_with_funding: donation is not funding-sourced'
        using errcode = 'check_violation';
    end if;
    if p_amount_minor <> v_donation.amount_minor or p_unit <> v_donation.unit then
      raise exception 'purchase_with_funding: tendered amount does not match the donation'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_purpose = 'GAME_PURCHASE' and not exists (
    select 1 from app.game_upgrades where code = p_game_target_code
    union
    select 1 from app.game_machine_types where code = p_game_target_code
  ) then
    raise exception 'purchase_with_funding: unknown game target %', p_game_target_code
      using errcode = 'check_violation';
  end if;

  v_entry := app_private.post_funding_spend_debit(
    p_user_id, p_amount_minor, p_unit,
    coalesce(p_order_id::text, p_donation_id::text, p_game_target_code),
    'spend:' || p_idempotency_key, p_correlation_id,
    jsonb_build_object(
      'purpose', p_purpose::text,
      'orderId', p_order_id, 'donationId', p_donation_id,
      'gameTarget', p_game_target_code
    )
  );

  insert into app.funding_spend_events (
    user_id, purpose, game_target_code, order_id, donation_id,
    amount_minor, unit, ledger_entry_id, idempotency_key
  ) values (
    p_user_id, p_purpose, p_game_target_code, p_order_id, p_donation_id,
    p_amount_minor, p_unit, v_entry.id, p_idempotency_key
  )
  returning * into v_spend;

  if p_purpose = 'PERK_PURCHASE' then
    update app.paid_perk_orders
    set status = 'FULFILLED', funding_spend_entry_id = v_entry.id,
        fulfilled_at = now()
    where id = p_order_id;

    insert into app.paid_entitlements (user_id, product_id, order_id, ends_at)
    values (
      p_user_id, v_order.product_id, p_order_id,
      case when v_product.duration_seconds is not null
        then now() + make_interval(secs => v_product.duration_seconds)
        else null end
    );
  end if;

  if p_purpose = 'DONATION_FROM_FUNDING' then
    update app.donations set status = 'ACKNOWLEDGED' where id = p_donation_id;
  end if;

  if p_purpose = 'GAME_PURCHASE' then
    insert into app.game_events (user_id, event_type, payload)
    values (
      p_user_id, 'FUNDED_PURCHASE',
      jsonb_build_object(
        'targetCode', p_game_target_code,
        'spendEventId', v_spend.id,
        'ledgerEntryId', v_entry.id,
        'correlationId', p_correlation_id
      )
    );
  end if;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'funding.spent', 'funding_spend_event', v_spend.id::text,
    jsonb_build_object(
      'spendEventId', v_spend.id, 'userId', p_user_id,
      'purpose', p_purpose::text, 'amountMinor', p_amount_minor, 'unit', p_unit
    )
  ) on conflict do nothing;

  return v_spend;
end;
$$;

revoke all on function app_private.purchase_with_funding(uuid, app.funding_spend_purpose, bigint, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.purchase_with_funding(uuid, app.funding_spend_purpose, bigint, text, text, text, uuid, uuid, uuid) to service_role;
-- Doc 83 DONATIONS: recording is acknowledgement, never money movement. This
-- function posts NO ledger entry. A funding-sourced donation (funding_source
-- USER_FUNDING) is paid separately through purchase_with_funding with purpose
-- DONATION_FROM_FUNDING; an external donation needs no debit at all.
--
-- Idempotent on p_idempotency_key: a retried record returns the existing row.
create or replace function app_private.record_donation(
  p_user_id uuid,
  p_amount_minor bigint,
  p_unit text,
  p_funding_source text,
  p_idempotency_key text,
  p_note text default null
) returns app.donations
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.donations;
  v_donation app.donations;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'record_donation: amount must be positive'
      using errcode = 'check_violation';
  end if;

  if p_funding_source not in (
    'EXTERNAL_MINIPAY','EXTERNAL_CASH_LINK','EXTERNAL_DAIMO','USER_FUNDING'
  ) then
    raise exception 'record_donation: unknown funding source %', p_funding_source
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'record_donation: an idempotency key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_existing
  from app.donations where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  insert into app.donations (
    user_id, amount_minor, unit, funding_source, idempotency_key, note
  ) values (
    p_user_id, p_amount_minor, p_unit, p_funding_source, p_idempotency_key, p_note
  )
  returning * into v_donation;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'donation.recorded', 'donation', v_donation.id::text,
    jsonb_build_object(
      'donationId', v_donation.id, 'userId', p_user_id,
      'amountMinor', p_amount_minor, 'unit', p_unit,
      'fundingSource', p_funding_source
    )
  ) on conflict do nothing;

  return v_donation;
end;
$$;

revoke all on function app_private.record_donation(uuid, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function app_private.record_donation(uuid, bigint, text, text, text, text) to service_role;
-- Doc 83 REFUNDS: revoking an entitlement never rewrites reward history. The
-- entitlement is marked REVOKED with a reason, and a compensating CREDIT
-- returns the verified spend amount to the USER_FUNDING account. The original
-- spend event and its debit are untouched; the refund is a NEW spend event
-- with is_refund = true plus a separate ledger entry.
--
-- Idempotent on p_idempotency_key. Only a FULFILLED PERK_PURCHASE spend can be
-- refunded, and only once.
create or replace function app_private.refund_funding_spend(
  p_spend_event_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid default null
) returns app.funding_spend_events
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.funding_spend_events;
  v_spend app.funding_spend_events;
  v_entry app.ledger_entries;
  v_funding uuid;
  v_refund app.funding_spend_events;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'refund_funding_spend: a reason is required'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'refund_funding_spend: an idempotency key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_existing
  from app.funding_spend_events where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_spend from app.funding_spend_events
  where id = p_spend_event_id for update;
  if not found then
    raise exception 'refund_funding_spend: unknown spend event'
      using errcode = 'foreign_key_violation';
  end if;

  if v_spend.is_refund then
    raise exception 'refund_funding_spend: a refund cannot itself be refunded'
      using errcode = 'check_violation';
  end if;

  if v_spend.purpose <> 'PERK_PURCHASE' or v_spend.order_id is null then
    raise exception 'refund_funding_spend: only a fulfilled perk purchase can be refunded'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from app.funding_spend_events
    where refund_of = v_spend.id
  ) then
    raise exception 'refund_funding_spend: this spend was already refunded'
      using errcode = 'check_violation';
  end if;

  select id into v_funding
  from app.ledger_accounts
  where user_id = v_spend.user_id and domain = 'USER_FUNDING' and unit = v_spend.unit;
  if not found then
    raise exception 'refund_funding_spend: no user funding account for this user and unit'
      using errcode = 'foreign_key_violation';
  end if;

  -- Compensating CREDIT to USER_FUNDING with the SAME source type. The
  -- original DEBIT is never edited (law 15, doc 75 REFUND / REVERSAL).
  v_entry := app_private.post_ledger_entry(
    v_funding, 'CREDIT', v_spend.amount_minor, v_spend.unit,
    'USER_FUNDING_SPEND', v_spend.id::text,
    'refund:' || p_idempotency_key, p_correlation_id,
    jsonb_build_object(
      'refundOf', v_spend.id, 'orderId', v_spend.order_id, 'actorId', p_actor_id
    )
  );

  insert into app.funding_spend_events (
    user_id, purpose, order_id, amount_minor, unit, ledger_entry_id,
    idempotency_key, is_refund, refund_of, reason
  ) values (
    v_spend.user_id, v_spend.purpose, v_spend.order_id,
    v_spend.amount_minor, v_spend.unit, v_entry.id,
    p_idempotency_key, true, v_spend.id, p_reason
  )
  returning * into v_refund;

  update app.paid_perk_orders
  set status = 'REFUNDED', refunded_at = now()
  where id = v_spend.order_id;

  update app.paid_entitlements
  set status = 'REVOKED', revoked_at = now(), revoke_reason = p_reason
  where order_id = v_spend.order_id and status = 'ACTIVE';

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result,
    correlation_id, after_state
  ) values (
    p_actor_id, 'funding.spend.refunded', 'funding_spend_event',
    v_spend.id::text, p_reason, 'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'refundEventId', v_refund.id, 'amountMinor', v_spend.amount_minor,
      'unit', v_spend.unit
    )
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'funding.spend.refunded', 'funding_spend_event', v_refund.id::text,
    jsonb_build_object(
      'refundEventId', v_refund.id, 'refundedEventId', v_spend.id,
      'userId', v_spend.user_id
    )
  ) on conflict do nothing;

  return v_refund;
end;
$$;

revoke all on function app_private.refund_funding_spend(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function app_private.refund_funding_spend(uuid, uuid, text, text, uuid) to service_role;
-- The 50 newest ACTIVE products, then the caller's entitlements. Filtered
-- BEFORE the cap; capped in SQL (AGENTS.md wrapper rules).
create or replace function public.list_perk_products(
  p_user_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
begin
  return query
  select jsonb_build_object(
    'id', p.id,
    'code', p.code,
    'kind', p.kind,
    'name', p.name,
    'description', p.description,
    'priceMinor', p.price_minor,
    'unit', p.unit,
    'billingPeriod', p.billing_period,
    'durationSeconds', p.duration_seconds,
    'isActive', p.is_active,
    'owned', exists (
      select 1 from app.paid_entitlements e
      where e.user_id = p_user_id and e.product_id = p.id and e.status = 'ACTIVE'
    )
  )
  from app.paid_perk_products p
  where p.is_active
  order by p.created_at
  limit least(coalesce(p_limit, 50), 50);
end;
$$;

revoke all on function public.list_perk_products(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_perk_products(uuid, integer) to service_role;

-- The caller's own entitlements only. Boolean-with-row pattern is not needed
-- here: the function takes no record id, so there is nothing to probe.
create or replace function public.list_my_entitlements(
  p_user_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
begin
  return query
  select jsonb_build_object(
    'id', e.id,
    'productCode', p.code,
    'productName', p.name,
    'kind', p.kind,
    'status', e.status,
    'startsAt', e.starts_at,
    'endsAt', e.ends_at
  )
  from app.paid_entitlements e
  join app.paid_perk_products p on p.id = e.product_id
  where e.user_id = p_user_id
  order by e.created_at desc
  limit least(coalesce(p_limit, 50), 50);
end;
$$;

revoke all on function public.list_my_entitlements(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_my_entitlements(uuid, integer) to service_role;

-- The caller's own funding-spend history. Amounts here are debits the caller
-- already owns; the projection carries no other user's data.
create or replace function public.list_my_funding_spends(
  p_user_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
begin
  return query
  select jsonb_build_object(
    'id', s.id,
    'purpose', s.purpose,
    'amountMinor', s.amount_minor,
    'unit', s.unit,
    'isRefund', s.is_refund,
    'createdAt', s.created_at
  )
  from app.funding_spend_events s
  where s.user_id = p_user_id
  order by s.created_at desc
  limit least(coalesce(p_limit, 50), 50);
end;
$$;

revoke all on function public.list_my_funding_spends(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_my_funding_spends(uuid, integer) to service_role;

-- Thin entry points so PostgREST can reach the commands (migration 035
-- pattern). Same signatures, no logic, no decisions.
create or replace function public.purchase_with_funding(p_user_id uuid, p_purpose app.funding_spend_purpose, p_amount_minor bigint, p_unit text, p_idempotency_key text, p_game_target_code text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_donation_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.funding_spend_events
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.purchase_with_funding(p_user_id, p_purpose, p_amount_minor, p_unit, p_idempotency_key, p_game_target_code, p_order_id, p_donation_id, p_correlation_id);
$$;

revoke all on function public.purchase_with_funding(p_user_id uuid, p_purpose app.funding_spend_purpose, p_amount_minor bigint, p_unit text, p_idempotency_key text, p_game_target_code text, p_order_id uuid, p_donation_id uuid, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.purchase_with_funding(p_user_id uuid, p_purpose app.funding_spend_purpose, p_amount_minor bigint, p_unit text, p_idempotency_key text, p_game_target_code text, p_order_id uuid, p_donation_id uuid, p_correlation_id uuid) to service_role;

create or replace function public.record_donation(p_user_id uuid, p_amount_minor bigint, p_unit text, p_funding_source text, p_idempotency_key text, p_note text DEFAULT NULL::text)
returns app.donations
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.record_donation(p_user_id, p_amount_minor, p_unit, p_funding_source, p_idempotency_key, p_note);
$$;

revoke all on function public.record_donation(p_user_id uuid, p_amount_minor bigint, p_unit text, p_funding_source text, p_idempotency_key text, p_note text) from public, anon, authenticated;
grant execute on function public.record_donation(p_user_id uuid, p_amount_minor bigint, p_unit text, p_funding_source text, p_idempotency_key text, p_note text) to service_role;

create or replace function public.refund_funding_spend(p_spend_event_id uuid, p_actor_id uuid, p_reason text, p_idempotency_key text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.funding_spend_events
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.refund_funding_spend(p_spend_event_id, p_actor_id, p_reason, p_idempotency_key, p_correlation_id);
$$;

revoke all on function public.refund_funding_spend(p_spend_event_id uuid, p_actor_id uuid, p_reason text, p_idempotency_key text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.refund_funding_spend(p_spend_event_id uuid, p_actor_id uuid, p_reason text, p_idempotency_key text, p_correlation_id uuid) to service_role;
