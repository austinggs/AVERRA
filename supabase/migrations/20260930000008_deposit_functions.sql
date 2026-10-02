-- =============================================================================
-- Averra migration 008: Deposit command functions
--
-- Source of truth: 38_PAYMENT_OPERATIONS.txt, 84_USER_FUNDING_DEPOSIT_SYSTEM.md,
--                  48_DATABASE_SCHEMA.txt, 56_FINANCIAL_CONTROLS.txt,
--                  11_AUTH_IDENTITY_KYC.txt, 71_ARCHITECTURAL_LAWS.md,
--                  docs/adr/0004-token-candidacy-tiers.md
--
-- Migration 005 created the deposit TABLES. This migration creates the COMMANDS.
--
-- Two separate controls, deliberately (law 41, doc 11):
--   1. record_deposit_verification - the server independently checks evidence.
--   2. confirm_deposit            - a human authorises the credit.
-- Neither can be performed by the user, and neither substitutes for the other.
-- A VERIFIED deposit is still NOT creditable (laws 41 and 44).
--
-- Every credit posts a USER_FUNDING_DEPOSIT entry. It can never post a
-- REWARD_EARNED entry, so a deposit never becomes withdrawable reward
-- liability (laws 42, 43 and 54).
-- =============================================================================

-- Records the result of independent on-chain verification. This does NOT credit
-- anything. A PASS moves the deposit to VERIFIED, which is still not creditable.
create or replace function app_private.record_deposit_verification(
  p_deposit_id uuid,
  p_result text,
  p_reason_code text default null,
  p_observed_amount_minor bigint default null,
  p_evidence jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
) returns app.deposit_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_req app.deposit_requests;
  v_token app.deposit_token_configs;
  v_dest app.platform_destinations;
begin
  if p_result not in ('PASS','FAIL','REVIEW') then
    raise exception 'record_deposit_verification: result must be PASS, FAIL or REVIEW'
      using errcode = 'check_violation';
  end if;

  select * into v_req from app.deposit_requests where id = p_deposit_id for update;
  if not found then
    raise exception 'record_deposit_verification: unknown deposit %', p_deposit_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_req.status in ('CONFIRMED','REJECTED','CANCELLED') then
    raise exception 'record_deposit_verification: deposit is already terminal (%)', v_req.status
      using errcode = 'check_violation';
  end if;

  if v_req.status <> 'SUBMITTED' then
    raise exception 'record_deposit_verification: only a SUBMITTED deposit can be verified (is %)',
      v_req.status using errcode = 'check_violation';
  end if;

  -- An expired request never becomes creditable by verification. Late funds stay
  -- reviewable, but expiry forbids automatic credit (law 53).
  if v_req.expires_at < now() and p_result = 'PASS' then
    raise exception 'record_deposit_verification: request expired at %, route to NEEDS_REVIEW',
      v_req.expires_at using errcode = 'check_violation';
  end if;

  -- Law 48: the token must be an ACTIVE, verified production token. A candidate
  -- row, or an active row without a verified contract, is never accepted.
  select * into v_token
  from app.deposit_token_configs
  where chain_id = v_req.chain_id
    and lower(contract_address) = lower(coalesce(v_req.token_contract, ''));

  if not found or v_token.is_active is not true then
    raise exception 'record_deposit_verification: token is not in the active production allowlist'
      using errcode = 'check_violation';
  end if;

  -- Law 47: Celo only. chain_id already implies this, stated explicitly.
  if v_req.chain_id <> 42220 then
    raise exception 'record_deposit_verification: only Celo (42220) is supported (got %)', v_req.chain_id
      using errcode = 'check_violation';
  end if;

  -- The destination must be an active Averra-controlled address.
  select * into v_dest
  from app.platform_destinations
  where chain_id = v_req.chain_id
    and lower(address) = lower(v_req.destination_address)
    and is_active;

  if not found then
    raise exception 'record_deposit_verification: destination is not an active Averra address'
      using errcode = 'check_violation';
  end if;

  -- Law 52/84: exact amount is the matching signal, but only together with the
  -- token, destination and event identity. A mismatch is a review case, never a
  -- silent partial credit.
  if p_result = 'PASS' and p_observed_amount_minor is distinct from v_req.declared_amount_minor then
    p_result := 'REVIEW';
    p_reason_code := coalesce(p_reason_code, 'AMOUNT_MISMATCH');
  end if;

  insert into app.deposit_verifications (
    deposit_id, result, reason_code, chain_id, token_contract,
    destination_address, observed_amount_minor, evidence
  ) values (
    p_deposit_id, p_result, p_reason_code, v_req.chain_id, v_req.token_contract,
    v_req.destination_address, p_observed_amount_minor, coalesce(p_evidence, '{}'::jsonb)
  );

  update app.deposit_requests
  set verified_amount_minor = p_observed_amount_minor,
      verified_at = case when p_result = 'PASS' then now() else null end,
      verification_status = p_result,
      status = case when p_result = 'PASS' then 'VERIFIED'::app.deposit_status
                    else 'NEEDS_REVIEW'::app.deposit_status end,
      review_reason = case when p_result <> 'PASS' then p_reason_code else review_reason end
  where id = p_deposit_id
  returning * into v_req;

  insert into app.deposit_events (deposit_id, event_type, actor_type, payload)
  values (
    p_deposit_id,
    case when p_result = 'PASS' then 'VERIFIED'::app.deposit_event_type
         else 'NEEDS_REVIEW'::app.deposit_event_type end,
    'CHAIN',
    jsonb_build_object('result', p_result, 'reasonCode', p_reason_code, 'observedMinor', p_observed_amount_minor)
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'deposit.verified', 'deposit_request', p_deposit_id::text,
    jsonb_build_object('depositId', p_deposit_id, 'result', p_result, 'creditable', false)
  ) on conflict do nothing;

  return v_req;
end;
$$;


-- Creates a user deposit request. Returns the SERVER-SIDE allowlist and the
-- active destination. The client never invents a supported token (law 48, doc 51:
-- "never display an address or token as supported unless the server returned it").
create or replace function app_private.create_deposit_request(
  p_user_id uuid,
  p_declared_symbol text,
  p_declared_amount_minor bigint,
  p_sender_address text default null,
  p_ttl_hours integer default 24
) returns app.deposit_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_token app.deposit_token_configs;
  v_dest app.platform_destinations;
  v_req app.deposit_requests;
  v_reference text;
begin
  if p_declared_amount_minor is null or p_declared_amount_minor <= 0 then
    raise exception 'create_deposit_request: amount must be positive'
      using errcode = 'check_violation';
  end if;

  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 168 then
    raise exception 'create_deposit_request: ttl_hours must be between 1 and 168'
      using errcode = 'check_violation';
  end if;

  -- Only an ACTIVE production token may be requested. USDm and USAT seed
  -- inactive and stay invisible until RPC-verified (ADR-0004).
  select * into v_token
  from app.deposit_token_configs
  where chain_id = 42220 and upper(symbol) = upper(p_declared_symbol) and is_active;

  if not found then
    raise exception 'create_deposit_request: % is not an active supported token', p_declared_symbol
      using errcode = 'check_violation';
  end if;

  select * into v_dest
  from app.platform_destinations
  where chain_id = 42220 and method = 'MANUAL_MINIPAY_CRYPTO' and is_active
  order by created_at
  limit 1;

  if not found then
    raise exception 'create_deposit_request: no active Averra deposit destination is configured'
      using errcode = 'check_violation';
  end if;

  v_reference := 'AVR-' || upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

  insert into app.deposit_requests (
    user_id, method, status, request_reference, chain_id,
    declared_asset, declared_token_contract, declared_amount_minor, declared_unit,
    destination_address, sender_address, requested_at, expires_at
  ) values (
    p_user_id, 'MANUAL_MINIPAY_CRYPTO', 'PENDING', v_reference, 42220,
    v_token.symbol, v_token.contract_address, p_declared_amount_minor, v_token.symbol,
    v_dest.address, p_sender_address, now(), now() + make_interval(hours => p_ttl_hours)
  )
  returning * into v_req;

  insert into app.deposit_events (deposit_id, event_type, actor_type, actor_id, payload)
  values (
    v_req.id, 'CREATED', 'USER', p_user_id,
    jsonb_build_object('reference', v_reference, 'symbol', v_token.symbol, 'chainId', 42220)
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'deposit.created', 'deposit_request', v_req.id::text,
    jsonb_build_object('depositId', v_req.id, 'userId', p_user_id, 'symbol', v_token.symbol)
  ) on conflict do nothing;

  return v_req;
end;
$$;


-- Authorises the funding credit. This is the ONLY function that creates a
-- USER_FUNDING_DEPOSIT ledger entry, and it requires a VERIFIED deposit plus a
-- named authoriser who is not the requester (laws 41, 44, 55).
create or replace function app_private.confirm_deposit(
  p_deposit_id uuid,
  p_approver_id uuid,
  p_idempotency_key text,
  p_reason text default null,
  p_correlation_id uuid default null
) returns app.deposit_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_req app.deposit_requests;
  v_funding uuid;
  v_entry app.ledger_entries;
  v_amount bigint;
begin
  select * into v_req from app.deposit_requests where id = p_deposit_id for update;
  if not found then
    raise exception 'confirm_deposit: unknown deposit %', p_deposit_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent replay: an already-confirmed deposit returns unchanged.
  if v_req.status = 'CONFIRMED' then
    return v_req;
  end if;

  -- Law 41: independent verification MUST have happened first. Confirming a
  -- SUBMITTED or PENDING deposit is impossible.
  if v_req.status not in ('VERIFIED','NEEDS_REVIEW') then
    raise exception 'confirm_deposit: deposit must be VERIFIED first (is %)', v_req.status
      using errcode = 'check_violation';
  end if;

  if v_req.status = 'NEEDS_REVIEW' and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'confirm_deposit: a reason is required to confirm a NEEDS_REVIEW deposit'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Law 55 / doc 38: no self-approval. The user who created the deposit can
  -- never be the operator who authorises the credit.
  if v_req.user_id = p_approver_id then
    raise exception 'confirm_deposit: the requester cannot approve their own deposit'
      using errcode = 'check_violation';
  end if;

  if p_approver_id is null then
    raise exception 'confirm_deposit: an authorised approver is required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The credit amount is the VERIFIED on-chain amount, never the declared one.
  v_amount := coalesce(v_req.verified_amount_minor, v_req.declared_amount_minor);

  if v_amount is null or v_amount <= 0 then
    raise exception 'confirm_deposit: no verified amount to credit'
      using errcode = 'check_violation';
  end if;

  v_funding := app_private.get_or_create_account(v_req.user_id, 'USER_FUNDING', v_req.declared_unit);

  -- Source type is USER_FUNDING_DEPOSIT. Never REWARD_EARNED: a deposit is not
  -- an earned reward and must never create reward liability (law 42).
  v_entry := app_private.post_ledger_entry(
    v_funding, 'CREDIT', v_amount, v_req.declared_unit,
    'USER_FUNDING_DEPOSIT', v_req.id::text,
    p_idempotency_key, p_correlation_id,
    jsonb_build_object(
      'depositId', v_req.id,
      'requestReference', v_req.request_reference,
      'chainId', v_req.chain_id,
      'tokenContract', v_req.token_contract,
      'txHash', v_req.tx_hash,
      'transferLogIndex', v_req.transfer_log_index,
      'approverId', p_approver_id
    )
  );

  update app.deposit_requests
  set status = 'CONFIRMED',
      admin_confirmed_at = now(),
      admin_confirmed_by = p_approver_id,
      funding_ledger_entry_id = v_entry.id
  where id = p_deposit_id
  returning * into v_req;

  insert into app.deposit_events (deposit_id, event_type, actor_type, actor_id, payload)
  values (
    p_deposit_id, 'CONFIRMED', 'ADMIN', p_approver_id,
    jsonb_build_object('amountMinor', v_amount, 'ledgerEntryId', v_entry.id, 'reason', p_reason)
  );

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_approver_id, 'deposit.confirmed', 'deposit_request', p_deposit_id::text,
    p_reason, 'SUCCESS', p_correlation_id,
    jsonb_build_object('status', 'CONFIRMED', 'amountMinor', v_amount, 'unit', v_req.declared_unit)
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'deposit.confirmed', 'deposit_request', p_deposit_id::text,
    jsonb_build_object('depositId', p_deposit_id, 'userId', v_req.user_id, 'amountMinor', v_amount)
  ) on conflict do nothing;

  return v_req;
end;
$$;

-- Rejects a deposit. No credit is ever created, and rejection is terminal.
create or replace function app_private.reject_deposit(
  p_deposit_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_correlation_id uuid default null
) returns app.deposit_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_req app.deposit_requests;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reject_deposit: a reason is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_req from app.deposit_requests where id = p_deposit_id for update;
  if not found then
    raise exception 'reject_deposit: unknown deposit %', p_deposit_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_req.status in ('CONFIRMED','REJECTED','CANCELLED') then
    raise exception 'reject_deposit: deposit is already terminal (%)', v_req.status
      using errcode = 'check_violation';
  end if;

  -- A confirmed deposit is never silently removed. Correcting a credit requires
  -- a compensating ledger entry through a separate authorised process (law 15).
  update app.deposit_requests
  set status = 'REJECTED', rejection_reason = p_reason
  where id = p_deposit_id
  returning * into v_req;

  insert into app.deposit_events (deposit_id, event_type, actor_type, actor_id, payload)
  values (p_deposit_id, 'REJECTED', 'ADMIN', p_actor_id, jsonb_build_object('reason', p_reason));

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_actor_id, 'deposit.rejected', 'deposit_request', p_deposit_id::text,
    p_reason, 'SUCCESS', p_correlation_id, jsonb_build_object('status', 'REJECTED')
  );

  return v_req;
end;
$$;

-- Lock down execution. No browser-facing role may verify, confirm or reject.
revoke all on function app_private.record_deposit_verification(uuid, text, text, bigint, jsonb, uuid) from public, anon, authenticated;
revoke all on function app_private.create_deposit_request(uuid, text, bigint, text, integer) from public, anon, authenticated;
revoke all on function app_private.confirm_deposit(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.reject_deposit(uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function app_private.record_deposit_verification(uuid, text, text, bigint, jsonb, uuid) to service_role;
grant execute on function app_private.create_deposit_request(uuid, text, bigint, text, integer) to service_role;
grant execute on function app_private.confirm_deposit(uuid, uuid, text, text, uuid) to service_role;
grant execute on function app_private.reject_deposit(uuid, uuid, text, uuid) to service_role;

