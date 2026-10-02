-- =============================================================================
-- Averra migration 034: Provider conversion, attribution and outcome commands
--
-- Source of truth: 20_PROVIDER_INTEGRATION.txt, 08_REWARD_ENGINE.md,
--                  62_PROVIDER_CALLBACKS.md, 71_ARCHITECTURAL_LAWS.md
--                  (laws 5, 20, 62)
--
-- Migration 014 created the provider tables and Migration 033 gave callbacks an
-- evidence row. Four more direct Data API accesses remained, all inside the
-- ingest path, and all of which would have failed with PGRST205:
--
--   * a read of provider_conversions for idempotency (ingest.ts)
--   * an INSERT into provider_conversions (ingest.ts)
--   * a re-read of provider_conversions on a unique violation (ingest.ts)
--   * a read of provider_participations to resolve the user (ingest.ts)
--   * an INSERT into provider_callback_results (evidence.ts)
--   * a read of reward_sources (the callback route)
--
-- Two of these deserve more than a mechanical port.
--
-- LAW 5 is enforced by a unique index on (provider_id, provider_event_id). The
-- ingest code relied on catching the 23505 and re-reading the winning row. That
-- is a correct pattern, but it was spread across two round trips in TypeScript
-- with the race window between them. `record_provider_conversion` keeps the
-- retry inside the function, so the losing caller learns the winning conversion
-- id from the same call that failed to create its own.
--
-- USER ATTRIBUTION IS THE SERIOUS ONE. The provider sends a tracking id, and the
-- ingest code resolved it to a user with
-- `.from('provider_participations').select('user_id').eq('tracking_id', ...)`.
-- That is correct in principle and catastrophic if it is ever wrong: a provider
-- callback naming someone else's tracking id would credit that other account.
-- `resolve_tracking_user` is therefore service_role-only, takes the provider id
-- as well as the tracking id, and returns ONLY a user id. It cannot be used to
-- enumerate participations, and it returns NULL rather than raising so the caller
-- cannot distinguish "no such tracking id" from "tracking id belongs to nobody".
--
-- Nothing in this migration creates a reward. Conversions are events; rewards come
-- from `grant_reward`, behind the risk gate, and are unchanged by this work.
-- =============================================================================

-- Resolves OUR minted tracking id to the user it belongs to.
--
-- Returns ONLY the user id, never the participation row. That is deliberate: the
-- ingest path needs to know who to credit and nothing else, so this cannot
-- become a read of the attribution table even if a caller were to pass a
-- deliberately wrong provider id.
create or replace function public.resolve_tracking_user(
  p_provider_id uuid,
  p_tracking_id text
) returns uuid
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select p.user_id
  from app.provider_participations p
  where p.provider_id = p_provider_id
    and p.tracking_id = p_tracking_id;
$$;

revoke all on function public.resolve_tracking_user(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_tracking_user(uuid, text) to service_role;

comment on function public.resolve_tracking_user(uuid, text) is
  'The user a tracking id we minted belongs to, or NULL. Resolves OUR identifier, '
  'never a provider-supplied user id, so a forged callback cannot credit a named account.';


-- Records one verified provider conversion.
--
-- On a duplicate provider event (law 5's unique index firing) the function
-- returns the EXISTING conversion id rather than raising. That is what makes it
-- safe for the ingest path: a repeated delivery is an expected outcome of a
-- retried webhook, not an error, and the caller needs the original conversion id
-- so it can record a DUPLICATE outcome against it.
--
-- The result is a jsonb OBJECT carrying both the id and whether it was a replay,
-- rather than an `out boolean` parameter.
--
-- An earlier version of this function declared `p_is_duplicate out boolean`
-- alongside `returns uuid`, which PostgreSQL rejects with 42P13: the OUT
-- parameter defines the result type, so a scalar return type is a contradiction
-- it will not resolve in the author's favour. `out` parameters are also awkward
-- over PostgREST, which has no clean representation for them. A single jsonb
-- return is unambiguous, and it is the shape the caller already reads.
--
-- The return is `{"id": uuid, "isDuplicate": boolean}`. `isDuplicate` is what
-- lets the caller distinguish a fresh record from a replay without a second
-- query, which is the entire point of collapsing the race into this function.
create or replace function app_private.record_provider_conversion(
  p_provider_id uuid,
  p_provider_event_id text,
  p_source_type text,
  p_event_type text,
  p_callback_id bigint default null,
  p_campaign_ref text default null,
  p_user_id uuid default null,
  p_tracking_id text default null,
  p_status text default 'RECEIVED',
  p_gross_value_minor bigint default null,
  p_currency text default null,
  p_event_timestamp timestamptz default null,
  p_normalized_payload jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'record_provider_conversion: provider_event_id is required'
      using errcode = 'not_null_violation';
  end if;

  -- Checked first so the common replay case never raises. The unique index below
  -- is still what actually guarantees law 5; this read is an optimisation, not
  -- the enforcement.
  select c.id into v_existing
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.provider_event_id = p_provider_event_id;

  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'isDuplicate', true);
  end if;

  begin
    insert into app.provider_conversions (
      provider_id, callback_id, provider_event_id, source_type, campaign_ref,
      user_id, tracking_id, event_type, status, gross_value_minor, currency,
      event_timestamp, normalized_payload, correlation_id
    )
    values (
      p_provider_id, p_callback_id, p_provider_event_id,
      p_source_type::app.provider_source_type, p_campaign_ref,
      p_user_id, p_tracking_id, p_event_type,
      p_status::app.conversion_status, p_gross_value_minor, p_currency,
      p_event_timestamp, coalesce(p_normalized_payload, '{}'::jsonb), p_correlation_id
    )
    returning id into v_id;
  exception
    when unique_violation then
      -- A concurrent delivery won the race between the read above and this
      -- insert. That is law 5 doing its job, not a failure, so the loser is
      -- handed the winner's id rather than being told to retry blindly.
      select c.id into v_existing
      from app.provider_conversions c
      where c.provider_id = p_provider_id
        and c.provider_event_id = p_provider_event_id;

      if v_existing is null then
        -- The colliding row was not the one we looked for. That is a different
        -- constraint failing, so the original error is the honest one to raise.
        raise;
      end if;

      return jsonb_build_object('id', v_existing, 'isDuplicate', true);
  end;

  return jsonb_build_object('id', v_id, 'isDuplicate', false);
end;
$$;

revoke all on function app_private.record_provider_conversion(
  uuid, text, text, text, bigint, text, uuid, text, text, bigint, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated;

grant execute on function app_private.record_provider_conversion(
  uuid, text, text, text, bigint, text, uuid, text, text, bigint, text,
  timestamptz, jsonb, uuid
) to service_role;

comment on function app_private.record_provider_conversion(
  uuid, text, text, text, bigint, text, uuid, text, text, bigint, text,
  timestamptz, jsonb, uuid
) is
  'Records one verified provider conversion and returns {"id": uuid, "isDuplicate": boolean}. '
  'A replay returns the existing conversion with isDuplicate true. Law 5 is enforced by the '
  'unique index, not by this function. Creates no reward.';

-- Records what became of a callback, in the append-only results table.
--
-- Migration 014 gave provider_callback_results its own immutability trigger and
-- kept it separate from the raw evidence row on purpose: what a provider sent
-- and what we decided about it are different facts and must be able to disagree.
-- The comment on recordCallbackOutcome() in the codebase says exactly that.
--
-- The unique primary key on callback_id is what makes this idempotent: a retried
-- outcome for the same callback collides rather than producing a second, subtly
-- different record of the same decision.
create or replace function app_private.record_callback_outcome(
  p_callback_id bigint,
  p_processing_result text,
  p_reason_code text default null,
  p_conversion_id uuid default null,
  p_correlation_id uuid default null
) returns void
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  insert into app.provider_callback_results (
    callback_id, processing_result, reason_code, conversion_id, correlation_id
  )
  values (
    p_callback_id, p_processing_result, p_reason_code, p_conversion_id, p_correlation_id
  )
  on conflict (callback_id) do nothing;
end;
$$;

revoke all on function app_private.record_callback_outcome(bigint, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.record_callback_outcome(bigint, text, text, uuid, uuid)
  to service_role;

comment on function app_private.record_callback_outcome(bigint, text, text, uuid, uuid) is
  'Appends the processing verdict for one callback. Idempotent on callback_id, so a retried '
  'worker cannot record two different verdicts about the same callback. Never updates the '
  'raw evidence row (law 20).';

-- Whether a tracking id has already produced a conversion.
--
-- Used to refuse re-attributing an offer completion that has already converted.
-- Returns a boolean, not the user, so it cannot be used to discover who a
-- tracking id belongs to.
create or replace function public.tracking_already_converted(
  p_provider_id uuid,
  p_tracking_id text
) returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select exists (
    select 1 from app.provider_conversions c
    where c.provider_id = p_provider_id
      and c.tracking_id = p_tracking_id
      and c.user_id is not null
  );
$$;

revoke all on function public.tracking_already_converted(uuid, text)
  from public, anon, authenticated;
grant execute on function public.tracking_already_converted(uuid, text) to service_role;
-- Resolves the ACTIVE reward funding source for a provider, by its conventional
-- name.
--
-- LAW 10: a reward may never be funded by a source the event itself names. The
-- callback route used to read app.reward_sources directly and pass the id it
-- found into apply_conversion_reward. Moving the lookup here does more than
-- repair the Data API access; it makes the constraint structural. The name is
-- derived from the URL segment the request arrived on, so it still cannot be
-- dictated by the payload, and only an ACTIVE source can ever be returned.
--
-- Returns ONLY the id. A reward source row carries a budget balance, and the
-- caller needs to spend from it but has no business reading it.
create or replace function public.get_active_provider_reward_source(p_provider_code text)
returns uuid
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select s.id
  from app.reward_sources s
  where s.is_active
    and s.name = 'provider:' || p_provider_code;
$$;

revoke all on function public.get_active_provider_reward_source(text)
  from public, anon, authenticated;
grant execute on function public.get_active_provider_reward_source(text) to service_role;

comment on function public.get_active_provider_reward_source(text) is
  'The active reward source id for a provider, or NULL. Returns the id only, never the source '
  'row or its budget. A NULL means the conversion stays recorded and UNPAID, which is correct: '
  'a reward without a traceable funding source must not exist (law 10).';
-- The conversion already recorded for one provider event, or NULL.
--
-- Law 5's fast path. Returns the id and nothing else: the ingest path needs to
-- know that a replay has happened and which conversion it replays, and has no
-- business reading the conversion's contents through this route.
create or replace function public.get_conversion_for_event(
  p_provider_id uuid,
  p_provider_event_id text
) returns uuid
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select c.id
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.provider_event_id = p_provider_event_id;
$$;

revoke all on function public.get_conversion_for_event(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_conversion_for_event(uuid, text) to service_role;