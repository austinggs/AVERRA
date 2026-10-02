-- =============================================================================
-- Averra migration 032: Deposit submission command and per-request read
--
-- Source of truth: 38_PAYMENT_OPERATIONS.txt, 48_DATABASE_SCHEMA.txt,
--                  56_FINANCIAL_CONTROLS.txt, 71_ARCHITECTURAL_LAWS.md
--
-- MIGRATION 008 created the deposit COMMANDS, but it left a hole: the act of a
-- user submitting their transaction hash after paying had no command at all.
-- The API route performed it as a direct PostgREST UPDATE on
-- app.deposit_requests, plus a second and separate INSERT into
-- app.deposit_events.
--
-- Two things were wrong with that, and only one of them was a runtime bug:
--
--  1. It could not have worked. The `app` schema is not exposed through the
--     Supabase Data API, so `.from('deposit_requests')` targets a nonexistent
--     `public.deposit_requests` and fails with PGRST205 on every submission.
--
--  2. More seriously, it was the wrong SHAPE. The status change and its audit
--     event were two independent statements. An event that failed to insert left
--     the deposit SUBMITTED with no record of who submitted it or when, and the
--     route could only log that failure and carry on. A deposit request is a
--     financial object; its state transition and its evidence belong in one
--     transaction, or neither should be believed.
--
-- `submit_deposit_tx` fixes both. It is the only way a deposit request leaves
-- PENDING, and it writes the event in the same transaction.
--
-- What it deliberately does NOT do is credit anything. It records evidence. The
-- chain of custody to money is unchanged, and unchanged in order:
--
--   user submits tx hash     -> submit_deposit_tx           (SUBMITTED, no money)
--   server verifies on chain -> record_deposit_verification (VERIFIED, no money)
--   human authorises         -> confirm_deposit             (USER_FUNDING_DEPOSIT)
--
-- A SUBMITTED deposit is not a confirmed deposit, and it is certainly not a
-- reward. See law 41 and law 44.
-- =============================================================================

-- Records the user's transaction hash against their own PENDING deposit request.
--
-- Ownership, state and expiry are all checked HERE rather than in the route,
-- because this is the function that decides. A caller passing somebody else's
-- deposit id gets the same error it would get for one that does not exist, so
-- this cannot be used to probe which deposit ids are real.
--
-- Re-submission is idempotent on the same hash and a CONFLICT on a different
-- one. That distinction matters: a user who taps twice has done nothing wrong and
-- should not be told their request is broken, but a user whose hash CHANGES after
-- submission has altered the evidence and must go to review instead.

create or replace function app_private.submit_deposit_tx(
  p_user_id uuid,
  p_deposit_id uuid,
  p_tx_hash text,
  p_screenshot_reference text default null,
  p_correlation_id uuid default null
) returns app.deposit_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_req app.deposit_requests;
  v_hash text;
begin
  if p_tx_hash is null or btrim(p_tx_hash) = '' then
    raise exception 'submit_deposit_tx: transaction hash is required'
      using errcode = 'not_null_violation';
  end if;

  -- Normalised once, here, so the comparison below cannot be defeated by
  -- letter case or stray whitespace.
  v_hash := lower(btrim(p_tx_hash));

  select * into v_req
  from app.deposit_requests
  where id = p_deposit_id and user_id = p_user_id
  for update;

  -- One message for "not yours" and "not there". Distinguishing them would let
  -- this endpoint enumerate deposit ids belonging to other users.
  if not found then
    raise exception 'submit_deposit_tx: unknown deposit reference'
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent replay: the hash matches what is already recorded, so this is the
  -- same submission arriving twice, not a new claim about the same payment.
  if v_req.tx_hash is not null and lower(v_req.tx_hash) = v_hash then
    return v_req;
  end if;

  if v_req.status <> 'PENDING' then
    raise exception 'submit_deposit_tx: deposit is % and no longer accepts a transaction hash',
      v_req.status using errcode = 'check_violation';
  end if;

  -- An expired request cannot be submitted into. Funds arriving against an
  -- expired destination still reach review; they do not get the fast path
  -- (law 53).
  if v_req.expires_at < now() then
    raise exception 'submit_deposit_tx: request expired at %', v_req.expires_at
      using errcode = 'check_violation';
  end if;

  update app.deposit_requests
  set tx_hash = v_hash,
      status = 'SUBMITTED',
      submitted_at = now(),
      updated_at = now()
  where id = v_req.id
  returning * into v_req;

  -- The audit event is part of the same transaction as the state change. If this
  -- insert fails the update rolls back with it, so a SUBMITTED deposit always
  -- has a record of who submitted it and when.
  insert into app.deposit_events (deposit_id, event_type, actor_type, actor_id, payload)
  values (
    v_req.id,
    'SUBMITTED',
    'USER',
    p_user_id,
    jsonb_build_object(
      'txHash', v_hash,
      'hasScreenshot', (p_screenshot_reference is not null),
      'correlationId', p_correlation_id
    )
  );

  return v_req;
end;
$$;

revoke all on function app_private.submit_deposit_tx(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.submit_deposit_tx(uuid, uuid, text, text, uuid)
  to service_role;

comment on function app_private.submit_deposit_tx(uuid, uuid, text, text, uuid) is
  'Records a user''s transaction hash on their own PENDING deposit request and writes the '
  'audit event in the same transaction. Credits nothing: SUBMITTED is evidence, not money. '
  'Verification and human confirmation remain separate, later steps (law 41, law 44).';


-- One deposit request, scoped to its owner.
--
-- Returns NULL for another user's deposit rather than raising, so the detail
-- page produces a 404 instead of a 403 and discloses nothing about whether the
-- id exists.
create or replace function public.get_my_deposit(p_user_id uuid, p_deposit_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'reference', d.request_reference,
    'chainId', d.chain_id,
    'declaredAsset', d.declared_asset,
    'declaredAmountMinor', d.declared_amount_minor,
    'declaredUnit', d.declared_unit,
    'destinationAddress', d.destination_address,
    'txHash', d.tx_hash,
    'requestedAt', d.requested_at,
    'expiresAt', d.expires_at,
    'submittedAt', d.submitted_at,
    'verifiedAmountMinor', d.verified_amount_minor,
    'verifiedAt', d.verified_at,
    'verificationStatus', d.verification_status,
    'reviewReason', d.review_reason,
    'rejectionReason', d.rejection_reason,
    'confirmedAt', d.admin_confirmed_at
  )
  from app.deposit_requests d
  where d.id = p_deposit_id and d.user_id = p_user_id;
$$;

revoke all on function public.get_my_deposit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_deposit(uuid, uuid) to service_role;

comment on function public.get_my_deposit(uuid, uuid) is
  'One deposit request owned by the given user, or NULL. Never returns another user''s deposit.';