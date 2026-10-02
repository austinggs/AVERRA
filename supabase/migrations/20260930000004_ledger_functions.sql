-- =============================================================================
-- Averra migration 004: Ledger + reward engine functions
--
-- Source of truth: 35_REWARD_ENGINE.txt, 36_WALLET_LEDGER.txt, 56_FINANCIAL_CONTROLS.txt,
--                  50_BACKEND_ARCHITECTURE.txt, 71_ARCHITECTURAL_LAWS.md,
--                  docs/adr/0001-financial-authority.md
--
-- app_private.post_ledger_entry is the ONLY writer of ledger_entries. Everything
-- else (rewards, deposits, spends, withdrawals, fees) is expressed as calls to it.
-- EXECUTE is revoked from PUBLIC, anon and authenticated, so a leaked publishable
-- key cannot invoke a financial mutation (law 1, law 44, ADR-0001).
-- =============================================================================

-- Returns the account id for a user-facing or platform account, creating it on
-- first use. Not a financial mutation itself: it moves no money.
create or replace function app_private.get_or_create_account(
  p_user_id uuid,
  p_domain app.financial_domain,
  p_unit text
) returns uuid
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from app.ledger_accounts
  where domain = p_domain
    and unit = p_unit
    and user_id is not distinct from p_user_id;

  if found then
    return v_id;
  end if;

  insert into app.ledger_accounts (user_id, domain, unit)
  values (p_user_id, p_domain, p_unit)
  returning id into v_id;

  insert into app.account_balances (account_id, balance_minor)
  values (v_id, 0)
  on conflict (account_id) do nothing;

  return v_id;
end;
$$;

-- The single append-only writer.
--
-- Idempotency: if the idempotency key has been seen, the existing entry is
-- returned and NOTHING is posted again. This is what makes a replayed provider
-- callback or a double-clicked confirmation harmless (laws 5, 51).
create or replace function app_private.post_ledger_entry(
  p_account_id uuid,
  p_direction app.ledger_direction,
  p_amount_minor bigint,
  p_unit text,
  p_source_type app.ledger_source_type,
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
  v_entry app.ledger_entries;
  v_account app.ledger_accounts;
  v_delta bigint;
  v_new_balance bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'post_ledger_entry: amount_minor must be positive'
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'post_ledger_entry: idempotency_key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Idempotent replay path.
  select * into v_entry from app.ledger_entries where idempotency_key = p_idempotency_key;
  if found then
    return v_entry;
  end if;

  select * into v_account from app.ledger_accounts where id = p_account_id;
  if not found then
    raise exception 'post_ledger_entry: unknown account %', p_account_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_account.unit <> p_unit then
    raise exception 'post_ledger_entry: unit mismatch (account=%, entry=%)', v_account.unit, p_unit
      using errcode = 'datatype_mismatch';
  end if;

  insert into app.ledger_entries (
    account_id, direction, amount_minor, unit, source_type, source_id,
    idempotency_key, correlation_id, metadata
  ) values (
    p_account_id, p_direction, p_amount_minor, p_unit, p_source_type, p_source_id,
    p_idempotency_key, p_correlation_id, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_entry;

  v_delta := case when p_direction = 'CREDIT' then p_amount_minor else -p_amount_minor end;

  insert into app.account_balances (account_id, balance_minor, last_entry_id, last_derived_at)
  values (p_account_id, v_delta, v_entry.id, now())
  on conflict (account_id) do update
    set balance_minor = app.account_balances.balance_minor + v_delta,
        last_entry_id = v_entry.id,
        last_derived_at = now()
  returning balance_minor into v_new_balance;

  -- A user-facing balance may never go negative and may never be unbacked.
  -- Fraud controls may hold or reject a future event, but they must never put the
  -- ledger into an impossible state (laws 1, 15).
  if v_account.domain in ('EARNED_REWARD','USER_FUNDING') and v_new_balance < 0 then
    raise exception 'post_ledger_entry: insufficient funds in % account (would be % %)',
      v_account.domain, v_new_balance, v_account.unit
      using errcode = 'check_violation';
  end if;

  -- Durable outbox, written in the SAME transaction as the financial entry.
  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'ledger.entry.posted',
    'ledger_entry',
    v_entry.id::text,
    jsonb_build_object(
      'entryId', v_entry.id,
      'accountId', p_account_id,
      'direction', p_direction::text,
      'amountMinor', p_amount_minor,
      'unit', p_unit,
      'sourceType', p_source_type::text,
      'sourceId', p_source_id,
      'correlationId', p_correlation_id
    )
  ) on conflict do nothing;

  return v_entry;
end;
$$;

-- Rebuilds the balance cache from ledger_entries alone. If this ever disagrees
-- with the cache, the ledger is right and the cache was wrong (36_WALLET_LEDGER).
create or replace function app_private.rebuild_account_balances()
returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_count integer;
begin
  with agg as (
    select account_id,
           sum(case when direction = 'CREDIT' then amount_minor else -amount_minor end) as balance_minor,
           max(id) as last_entry_id
    from app.ledger_entries
    group by account_id
  )
  insert into app.account_balances (account_id, balance_minor, last_entry_id, last_derived_at)
  select la.id, coalesce(agg.balance_minor, 0), agg.last_entry_id, now()
  from app.ledger_accounts la
  left join agg on agg.account_id = la.id
  on conflict (account_id) do update
    set balance_minor = excluded.balance_minor,
        last_entry_id = excluded.last_entry_id,
        last_derived_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Mirrors src/lib/financial/fee.ts exactly. Integer maths only; the fee is rounded
-- down so rounding never charges above the published rate (law 45).
create or replace function app_private.calculate_fee_minor(
  p_gross_minor bigint,
  p_basis_points integer default 1500
) returns bigint
language plpgsql
immutable
as $$
begin
  if p_gross_minor is null or p_gross_minor < 0 then
    raise exception 'calculate_fee_minor: gross must not be negative'
      using errcode = 'check_violation';
  end if;
  if p_basis_points is null or p_basis_points < 0 or p_basis_points > 10000 then
    raise exception 'calculate_fee_minor: invalid basis points'
      using errcode = 'check_violation';
  end if;
  return (p_gross_minor * p_basis_points) / 10000;
end;
$$;

-- Dual control: the preparer may never approve their own action.
create or replace function app_private.assert_distinct_approver(
  p_request_id uuid,
  p_approver_id uuid
) returns void
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_preparer uuid;
begin
  select prepared_by into v_preparer from app.approval_requests where id = p_request_id;
  if not found then
    raise exception 'assert_distinct_approver: unknown approval request %', p_request_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_preparer is not distinct from p_approver_id then
    raise exception 'dual control violation: the preparer cannot approve their own action'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Lock down execution: these are privileged entry points, not public API.
revoke all on function app_private.get_or_create_account(uuid, app.financial_domain, text) from public, anon, authenticated;
revoke all on function app_private.rebuild_account_balances() from public, anon, authenticated;
revoke all on function app_private.calculate_fee_minor(bigint, integer) from public, anon, authenticated;
revoke all on function app_private.assert_distinct_approver(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.post_ledger_entry(uuid, app.ledger_direction, bigint, text, app.ledger_source_type, text, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function app_private.get_or_create_account(uuid, app.financial_domain, text) to service_role;
grant execute on function app_private.rebuild_account_balances() to service_role;
grant execute on function app_private.calculate_fee_minor(bigint, integer) to service_role;
grant execute on function app_private.assert_distinct_approver(uuid, uuid) to service_role;
grant execute on function app_private.post_ledger_entry(uuid, app.ledger_direction, bigint, text, app.ledger_source_type, text, text, uuid, jsonb) to service_role;
