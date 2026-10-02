-- =============================================================================
-- Averra migration 033: Provider callback evidence command
--
-- Source of truth: 20_PROVIDER_INTEGRATION.txt, 62_PROVIDER_CALLBACKS.md,
--                  71_ARCHITECTURAL_LAWS.md, docs/adr/
--
-- Migration 014 created app.provider_callbacks with an immutability trigger and
-- an explicit contract in its own COMMENT: "written before processing so a
-- failure cannot erase the trail". Nothing in the database actually permitted
-- that write. The ingest path performed it as a direct PostgREST INSERT into an
-- `app` table, which fails with PGRST205 because the schema is not exposed
-- through the Data API.
--
-- That means provider callback evidence has never actually been recorded. Every
-- provider callback on the platform was authenticated, verified and acted upon
-- with NO durable evidence row behind it. For a system whose law 62 requires
-- authenticated, validated and idempotent provider callbacks, and whose whole
-- fraud posture depends on being able to show what a provider actually sent, that
-- is the most serious gap found during the Data API migration work.
--
-- It was found by looking for `.from()` calls, not by reading the schema, which
-- is the argument for treating every direct table access as a defect to explain
-- rather than as code that happens to be there.
-- =============================================================================

-- Appends one raw provider callback to the evidence log.
--
-- The row is APPEND-ONLY by trigger. This function is the only insert path, and
-- it deliberately has no UPDATE or DELETE sibling. A callback is what a provider
-- actually sent us, recorded before we have decided anything about it;
create or replace function app_private.record_provider_callback(
  p_provider_id uuid,
  p_remote_address text default null,
  p_signature_present boolean default false,
  p_signature_algorithm text default null,
  p_verification_result text default 'ABSENT',
  p_verification_reason text default null,
  p_claimed_event_id text default null,
  p_claimed_event_timestamp timestamptz default null,
  p_raw_payload jsonb default '{}'::jsonb,
  p_payload_hash text default null,
  p_headers jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
) returns bigint
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_id bigint;
begin
  if p_payload_hash is null or btrim(p_payload_hash) = '' then
    -- The hash is what makes two deliveries of the same body comparable later.
    -- A row without one cannot be correlated with anything, so it is refused
    -- rather than stored as a weaker record.
    raise exception 'record_provider_callback: payload hash is required'
      using errcode = 'not_null_violation';
  end if;

  insert into app.provider_callbacks (
    provider_id, remote_address, signature_present, signature_algorithm,
    verification_result, verification_reason, claimed_event_id,
    claimed_event_timestamp, raw_payload, payload_hash, headers, correlation_id
  )
  values (
    p_provider_id, p_remote_address::inet, coalesce(p_signature_present, false),
    p_signature_algorithm,
    coalesce(p_verification_result, 'ABSENT')::app.callback_verification_result,
    p_verification_reason, p_claimed_event_id, p_claimed_event_timestamp,
    coalesce(p_raw_payload, '{}'::jsonb), p_payload_hash,
    coalesce(p_headers, '{}'::jsonb), p_correlation_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_private.record_provider_callback(
  uuid, text, boolean, text, text, text, text, timestamptz, jsonb, text, jsonb, uuid
) from public, anon, authenticated;

grant execute on function app_private.record_provider_callback(
  uuid, text, boolean, text, text, text, text, timestamptz, jsonb, text, jsonb, uuid
) to service_role;

comment on function app_private.record_provider_callback(
  uuid, text, boolean, text, text, text, text, timestamptz, jsonb, text, jsonb, uuid
) is
  'Appends one raw provider callback to the immutable evidence log and returns its id. '
  'Writes evidence only: no reward, no state transition, no user-visible effect. '
  'The row cannot be updated or deleted (law 62).';

-- correcting a mistake means recording what we later learned, not editing the
-- past.
--
-- The return value is the row id, so the caller can correlate this evidence with
-- the outcome row written after processing.
