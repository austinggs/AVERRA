-- =============================================================================
-- Averra migration 007: Withdrawal command functions
--
-- Source of truth: 37_WITHDRAWAL_SYSTEM.txt, 38_PAYMENT_OPERATIONS.txt,
--                  36_WALLET_LEDGER.txt, 56_FINANCIAL_CONTROLS.txt,
--                  71_ARCHITECTURAL_LAWS.md, docs/adr/0001-financial-authority.md,
--                  docs/adr/0003-withdrawal-lifecycle.md
--
-- Every function here is SECURITY DEFINER in app_private with EXECUTE revoked from
-- anon/authenticated. A leaked publishable key cannot move money (law 44).
--
-- Money model for a withdrawal, in ledger terms:
--   1. RESERVE  DEBIT  EARNED_REWARD  gross  <->  CREDIT PAYOUT_CLEARING gross
--   2. FEE      CREDIT FEE_REVENUE    fee
--   3. SETTLE   DEBIT  PAYOUT_CLEARING net
--   The reservation already removed gross from the user's earned balance, so the
--   user is never debited twice. Release is a compensating CREDIT, never an edit.
-- =============================================================================

-- Reserves a withdrawal. This is the ONLY path that debits earned reward balance
-- into a pending payout. Every ledger leg is idempotent on p_idempotency_key.
create or replace function app_private.create_withdrawal_request(
  p_user_id uuid,
  p_method text,
  p_destination_id uuid,
  p_gross_minor bigint,
  p_unit text,
  p_idempotency_key text,
  p_correlation_id uuid default null
) returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_dest app.payout_destinations;
  v_request app.withdrawal_requests;
  v_fee bigint;
  v_earned uuid;
  v_clearing uuid;
  v_fee_account uuid;
  v_reservation app.ledger_entries;
  v_fee_entry app.ledger_entries;
  v_balance bigint;
begin
  if p_gross_minor is null or p_gross_minor <= 0 then
    raise exception 'create_withdrawal_request: gross must be positive'
      using errcode = 'check_violation';
  end if;

  -- Idempotent replay: if this key already reserved funds, return that request.
  select w.* into v_request
  from app.withdrawal_requests w
  where exists (
    select 1 from app.ledger_entries e
    where e.id = w.reservation_entry_id
      and e.idempotency_key = p_idempotency_key
  );

  if found then
    return v_request;
  end if;

  -- The destination must exist, belong to this user, match the method, and be
  -- verified. An unverified MiniPay destination can never be paid (law 23).
  select * into v_dest
  from app.payout_destinations
  where id = p_destination_id and user_id = p_user_id;

  if not found then
    raise exception 'create_withdrawal_request: destination not found for user'
      using errcode = 'foreign_key_violation';
  end if;

  if v_dest.method <> p_method then
    raise exception 'create_withdrawal_request: destination method % does not match request method %',
      v_dest.method, p_method using errcode = 'check_violation';
  end if;

  if v_dest.status <> 'VERIFIED' then
    raise exception 'create_withdrawal_request: destination is not verified (status=%)', v_dest.status
      using errcode = 'check_violation';
  end if;

  if p_method in ('MINIPAY_MANUAL','BANK_MANUAL') and not exists (
    select 1 from app.minipay_destination_verifications
    where destination_id = p_destination_id and decision = 'VERIFIED'
  ) then
    raise exception 'create_withdrawal_request: manual payout destination lacks a verification record'
      using errcode = 'check_violation';
  end if;

  -- Only EARNED_REWARD is withdrawable. User Funding Balance is a real balance
  -- and is still NOT a withdrawal source (doc 37 BALANCE BOUNDARY, law 42).
  select id into v_earned
  from app.ledger_accounts
  where user_id = p_user_id and domain = 'EARNED_REWARD' and unit = p_unit;

  if not found then
    raise exception 'create_withdrawal_request: no earned reward account for this user and unit'
      using errcode = 'foreign_key_violation';
  end if;

  select balance_minor into v_balance from app.account_balances where account_id = v_earned;
  v_balance := coalesce(v_balance, 0);

  if v_balance < p_gross_minor then
    raise exception 'create_withdrawal_request: insufficient available earned balance (have %, requested %)',
      v_balance, p_gross_minor using errcode = 'check_violation';
  end if;

  v_fee := app_private.calculate_fee_minor(p_gross_minor, 1500);

  insert into app.withdrawal_requests (
    user_id, method, status, destination_id, unit,
    gross_amount_minor, fee_amount_minor, net_amount_minor, fee_basis_points, fee_disclosure
  ) values (
    p_user_id, p_method, 'REQUESTED', p_destination_id, p_unit,
    p_gross_minor, v_fee, p_gross_minor - v_fee, 1500,
    'Platform Service & Maintenance Fee: 15% of the gross withdrawal amount. '
    || 'Your net payout is the gross withdrawal amount minus this fee.'
  )
  returning * into v_request;

  -- 1. Reserve gross: out of earned reward, into payout clearing.
  v_reservation := app_private.post_ledger_entry(
    v_earned, 'DEBIT', p_gross_minor, p_unit,
    'WITHDRAWAL_RESERVATION', v_request.id::text,
    p_idempotency_key, p_correlation_id,
    jsonb_build_object('withdrawalId', v_request.id, 'method', p_method, 'leg', 'user_reservation')
  );

  v_clearing := app_private.get_or_create_account(null, 'PAYOUT_CLEARING', p_unit);
  perform app_private.post_ledger_entry(
    v_clearing, 'CREDIT', p_gross_minor, p_unit,
    'WITHDRAWAL_RESERVATION', v_request.id::text,
    p_idempotency_key || ':clearing', p_correlation_id,
    jsonb_build_object('withdrawalId', v_request.id, 'leg', 'clearing')
  );

  -- 2. The fee is recognised as platform revenue, separately (law 45).
  v_fee_account := app_private.get_or_create_account(null, 'FEE_REVENUE', p_unit);

  if v_fee > 0 then
    v_fee_entry := app_private.post_ledger_entry(
      v_fee_account, 'CREDIT', v_fee, p_unit,
      'PLATFORM_SERVICE_MAINTENANCE_FEE', v_request.id::text,
      p_idempotency_key || ':fee', p_correlation_id,
      jsonb_build_object('withdrawalId', v_request.id, 'basisPoints', 1500)
    );
  end if;

  insert into app.fee_records (
    user_id, withdrawal_id, fee_type, basis_points,
    gross_amount_minor, fee_amount_minor, net_amount_minor, unit, ledger_entry_id
  ) values (
    p_user_id, v_request.id, 'PLATFORM_SERVICE_MAINTENANCE_FEE', 1500,
    p_gross_minor, v_fee, p_gross_minor - v_fee, p_unit,
    case when v_fee > 0 then v_fee_entry.id else null end
  );

  update app.withdrawal_requests
  set reservation_entry_id = v_reservation.id,
      fee_entry_id = case when v_fee > 0 then v_fee_entry.id else null end,
      status = 'ELIGIBILITY_CHECKED'
  where id = v_request.id
  returning * into v_request;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'withdrawal.requested', 'withdrawal_request', v_request.id::text,
    jsonb_build_object(
      'withdrawalId', v_request.id, 'userId', p_user_id, 'method', p_method,
      'grossMinor', p_gross_minor, 'feeMinor', v_fee, 'netMinor', p_gross_minor - v_fee,
      'unit', p_unit
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    p_user_id, 'withdrawal.requested', 'withdrawal_request', v_request.id::text,
    'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'grossMinor', p_gross_minor, 'feeMinor', v_fee,
      'netMinor', p_gross_minor - v_fee, 'status', 'ELIGIBILITY_CHECKED'
    )
  );

  return v_request;
end;
$$;


-- Settles a confirmed withdrawal: the net leaves payout clearing.
--
-- APPROVED never means PAID. This may only run from PAYMENT_INITIATED onwards,
-- and a manual settlement can only be recorded by the operator who performed it
-- (law 27). A repeated call with the same idempotency key posts nothing further.
create or replace function app_private.settle_withdrawal(
  p_withdrawal_id uuid,
  p_payment_operation_id uuid,
  p_actor_id uuid,
  p_external_reference text,
  p_idempotency_key text,
  p_correlation_id uuid default null
) returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_request app.withdrawal_requests;
  v_op app.payment_operations;
  v_clearing uuid;
  v_entry app.ledger_entries;
begin
  select * into v_request from app.withdrawal_requests where id = p_withdrawal_id for update;
  if not found then
    raise exception 'settle_withdrawal: unknown withdrawal %', p_withdrawal_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_request.status in ('COMPLETED','FAILED','REJECTED','CANCELLED','EXPIRED') then
    raise exception 'settle_withdrawal: withdrawal is already terminal (%)', v_request.status
      using errcode = 'check_violation';
  end if;

  if v_request.status not in ('PAYMENT_INITIATED','CONFIRMED') then
    raise exception 'settle_withdrawal: cannot settle from status %', v_request.status
      using errcode = 'check_violation';
  end if;

  select * into v_op from app.payment_operations where id = p_payment_operation_id for update;
  if not found then
    raise exception 'settle_withdrawal: unknown payment operation %', p_payment_operation_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_op.withdrawal_id <> p_withdrawal_id then
    raise exception 'settle_withdrawal: payment operation does not belong to this withdrawal'
      using errcode = 'check_violation';
  end if;

  if v_op.settlement_status = 'SETTLED' then
    raise exception 'settle_withdrawal: payment operation is already settled'
      using errcode = 'check_violation';
  end if;

  if v_op.execution_mode = 'MANUAL_OPERATOR' and v_op.operator_id is distinct from p_actor_id then
    raise exception 'settle_withdrawal: only the performing operator may settle a manual payment'
      using errcode = 'check_violation';
  end if;

  if v_request.net_amount_minor > 0 then
    select id into v_clearing
    from app.ledger_accounts
    where domain = 'PAYOUT_CLEARING' and unit = v_request.unit and user_id is null
    limit 1;

    if v_clearing is null then
      raise exception 'settle_withdrawal: no payout clearing account for unit %', v_request.unit
        using errcode = 'foreign_key_violation';
    end if;

    v_entry := app_private.post_ledger_entry(
      v_clearing, 'DEBIT', v_request.net_amount_minor, v_request.unit,
      'WITHDRAWAL_SETTLEMENT', p_withdrawal_id::text,
      p_idempotency_key, p_correlation_id,
      jsonb_build_object(
        'withdrawalId', p_withdrawal_id,
        'paymentOperationId', p_payment_operation_id,
        'externalReference', p_external_reference
      )
    );

    update app.withdrawal_requests
    set settlement_entry_id = v_entry.id, status = 'COMPLETED'
    where id = p_withdrawal_id
    returning * into v_request;
  else
    update app.withdrawal_requests
    set status = 'COMPLETED'
    where id = p_withdrawal_id
    returning * into v_request;
  end if;

  update app.payment_operations
  set settlement_status = 'SETTLED',
      operator_completed_at = coalesce(operator_completed_at, now()),
      external_reference = coalesce(external_reference, p_external_reference)
  where id = p_payment_operation_id;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'withdrawal.settled', 'withdrawal_request', p_withdrawal_id::text,
    jsonb_build_object(
      'withdrawalId', p_withdrawal_id, 'netMinor', v_request.net_amount_minor,
      'unit', v_request.unit, 'paymentOperationId', p_payment_operation_id
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    p_actor_id, 'withdrawal.settled', 'withdrawal_request', p_withdrawal_id::text,
    'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'netMinor', v_request.net_amount_minor, 'externalReference', p_external_reference,
      'status', 'COMPLETED'
    )
  );

  return v_request;
end;
$$;


-- Releases a failed or cancelled withdrawal back to earned reward balance.
--
-- This is a COMPENSATING CREDIT, never an edit and never a delete. The original
-- reservation entry stays exactly where it is (law 7, law 15, doc 36 REVERSALS).
create or replace function app_private.release_withdrawal(
  p_withdrawal_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid default null
) returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_request app.withdrawal_requests;
  v_earned uuid;
  v_entry app.ledger_entries;
begin
  select * into v_request from app.withdrawal_requests where id = p_withdrawal_id for update;
  if not found then
    raise exception 'release_withdrawal: unknown withdrawal %', p_withdrawal_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_request.status in ('COMPLETED','REJECTED','CANCELLED','EXPIRED') then
    raise exception 'release_withdrawal: withdrawal is already terminal (%)', v_request.status
      using errcode = 'check_violation';
  end if;

  if v_request.release_entry_id is not null then
    raise exception 'release_withdrawal: withdrawal was already released'
      using errcode = 'check_violation';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'release_withdrawal: a reason is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select id into v_earned
  from app.ledger_accounts
  where user_id = v_request.user_id and domain = 'EARNED_REWARD' and unit = v_request.unit;

  if v_earned is null then
    raise exception 'release_withdrawal: no earned reward account to release to'
      using errcode = 'foreign_key_violation';
  end if;

  v_entry := app_private.post_ledger_entry(
    v_earned, 'CREDIT', v_request.gross_amount_minor, v_request.unit,
    'WITHDRAWAL_RELEASE', p_withdrawal_id::text,
    p_idempotency_key, p_correlation_id,
    jsonb_build_object(
      'withdrawalId', p_withdrawal_id, 'reason', p_reason,
      'compensates', v_request.reservation_entry_id
    )
  );

  update app.withdrawal_requests
  set release_entry_id = v_entry.id,
      status = case
        when status in ('REQUESTED','ELIGIBILITY_CHECKED','RISK_REVIEW',
                        'APPROVED','PROCESSING','PAYMENT_INITIATED')
          then 'CANCELLED'::app.withdrawal_status
        else 'FAILED'::app.withdrawal_status
      end
  where id = p_withdrawal_id
  returning * into v_request;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'withdrawal.released', 'withdrawal_request', p_withdrawal_id::text,
    jsonb_build_object(
      'withdrawalId', p_withdrawal_id, 'grossMinor', v_request.gross_amount_minor,
      'unit', v_request.unit, 'reason', p_reason
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_actor_id, 'withdrawal.released', 'withdrawal_request', p_withdrawal_id::text,
    p_reason, 'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'grossMinor', v_request.gross_amount_minor, 'status', v_request.status::text
    )
  );

  return v_request;
end;
$$;

-- Lock down execution: privileged entry points, not public API. A browser
-- holding only the publishable key cannot reserve, settle or release money.
revoke all on function app_private.create_withdrawal_request(uuid, text, uuid, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.settle_withdrawal(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.release_withdrawal(uuid, uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function app_private.create_withdrawal_request(uuid, text, uuid, bigint, text, text, uuid) to service_role;
grant execute on function app_private.settle_withdrawal(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function app_private.release_withdrawal(uuid, uuid, text, text, uuid) to service_role;

