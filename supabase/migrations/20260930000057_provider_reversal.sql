-- =============================================================================
-- Averra migration 057: Append-only provider reversals
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt, 13_OFFERWALL_SYSTEM.txt,
--                  05_REWARD_ECONOMICS.txt, 71_ARCHITECTURAL_LAWS.md
--                  (laws 5, 7, 12, 20, 42)
--
-- THE DEFECT THIS FIXES
--
-- CPX Research re-notifies a transaction when it detects fraud 15-60 days later,
-- using the SAME trans_id with status -2. Their own advisory panel states:
--
--     "Your postback URL will be called by us a second time, as soon as we cancel
--      a transaction. &status=1 (pending) to &status=-2 (reversed)."
--
-- Recorded under the bare trans_id, law 5's unique index on
-- (provider_id, provider_event_id) returns the ORIGINAL conversion as a DUPLICATE. So a
-- genuine fraud clawback was silently discarded: no reversal row, no
-- reverse_conversion call, no error anywhere - and CPX's dashboard showed the reversal
-- as delivered. This is the third instance of that failure family in this integration
-- (CR-0030's routing, then the amount scale) and the first that would cost real money.
--
-- WHY APPEND-ONLY RATHER THAN AN UPDATE
--
-- The tempting fix lets the reversal UPDATE the original row's status. That is a
-- financial rewrite: the row that said VALIDATED stops saying so, and the record of
-- what the provider originally asserted is gone (law 42). Law 7 requires a reversal to
-- be a compensating event.
--
-- So the reversal creates its OWN conversion row, carrying a distinct event identity,
-- linked to the original by a new self-referencing column. The original is never
-- rewritten by the ARRIVAL of a reversal; it is marked REVERSED only by the command
-- that has actually moved the money, which is a state transition rather than a rewrite
-- of what was received.
--
-- EVENT IDENTITY IS THE PART THAT HAD TO BE CHOSEN CAREFULLY
--
-- `trans_id` and `trans_id:-2` are distinct strings, so the unique index admits both.
-- A reversal is therefore recorded rather than discarded, and a REPLAYED reversal stays
-- idempotent because its suffix is deterministic: CPX sending status=-2 twice yields
-- the same id twice, which the index collapses.
--
-- A numeric comparison would have conflated 2 and -2. They are different vendor values
-- and both are real, so the suffix preserves the distinction.
--
-- Migration 014 is applied and is NOT edited. This creates the column forward.
-- =============================================================================

-- The conversion this row reverses, when the row is itself a reversal.
--
-- ON DELETE RESTRICT, because a conversion is financial history and deleting one must
-- never cascade away the evidence that another one was withdrawn.
--
-- A self-reference is refused: a conversion cannot reverse itself, which would let a
-- reversal mark its own status and report success without moving money.
alter table app.provider_conversions
  add column reverses_conversion_id uuid
    references app.provider_conversions(id) on delete restrict;

comment on column app.provider_conversions.reverses_conversion_id is
  'The conversion this row withdraws. Set only on a reversal row, and only by '
  'record_provider_reversal_conversion once it has matched an existing conversion for '
  'the same provider. NULL on an ordinary conversion, and NULL on an unmatched '
  'reversal - which is recorded rather than refused, because a vendor may withdraw a '
  'transaction we never received a completion for.';

alter table app.provider_conversions
  add constraint provider_conversions_no_self_reversal
  check (reverses_conversion_id is null or reverses_conversion_id <> id);

create index idx_provider_conversions_reverses
  on app.provider_conversions(reverses_conversion_id)
  where reverses_conversion_id is not null;

-- Looks up the ORIGINAL conversion a reversal withdraws.
--
-- Scoped by provider id, and returns ONLY the id. The ingest path needs to know which
-- row a reversal attaches to and nothing else; returning the conversion row would make
-- this a general read of the attribution table.
create or replace function public.get_original_conversion_for_reversal(
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

revoke all on function public.get_original_conversion_for_reversal(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_original_conversion_for_reversal(uuid, text)
  to service_role;

comment on function public.get_original_conversion_for_reversal(uuid, text) is
  'The conversion a reversal attaches to, or NULL. Returns the id only. Scoped by '
  'provider so one vendor can never name a conversion belonging to another.';

-- Records ONE reversal, linked to the original it withdraws.
--
-- A SEPARATE COMMAND RATHER THAN A PARAMETER ON record_provider_conversion.
--
-- The obvious alternative was `create or replace` on migration 034's function with an
-- appended p_reverses_event_id. That was tried first and rejected:
--
--   * it changes the signature of an APPLIED function, and migration 035's public
--     wrapper passes 14 positional arguments to it. check:migrations correctly refused
--     the build - the wrapper would compile and then fail at runtime, which is the worst
--     available combination;
--   * an ordinary completion and a withdrawal are different operations with different
--     rules. A reversal may be recorded when no original exists; an ordinary completion
--     may not invent a link. Forcing both through one function behind a flag means every
--     caller has to know which mode it is in.
--
-- Migration 034's function is therefore left byte-identical and this is additive. The
-- reversal path never calls it, so law 5's guarantee for ordinary conversions is
-- untouched.
--
-- IDEMPOTENCY IS LAW 5, AND IT IS STRUCTURAL
--
-- The reversal's own event id carries the vendor's status suffix, so a re-notified
-- reversal produces the same id and the existing row comes back with isDuplicate true.
-- That is the guarantee the completion path gets, arrived at the same way: the unique
-- index on (provider_id, provider_event_id).
--
-- AN UNMATCHED REVERSAL IS RECORDED, NOT REFUSED.
--
-- A vendor may withdraw a transaction whose completion never reached us - a lost
-- callback, an outage, or a transaction predating this integration. Raising here would
-- discard the only evidence that a withdrawal was offered, which is the mistake this
-- whole migration exists to stop making. The row is written with
-- reverses_conversion_id NULL and status REVERSED, so it stays visible and auditable,
-- and apply_provider_reversal reports the absence rather than inventing an original.
create or replace function app_private.record_provider_reversal_conversion(
  p_provider_id uuid,
  p_provider_event_id text,
  p_reverses_event_id text,
  p_source_type text,
  p_event_type text,
  p_callback_id bigint default null,
  p_campaign_ref text default null,
  p_currency text default null,
  p_gross_value_minor bigint default null,
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
  v_reverses uuid;
  v_id uuid;
begin
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'record_provider_reversal_conversion: provider_event_id is required'
      using errcode = 'not_null_violation';
  end if;

  -- A reversal with nothing to point at cannot be linked, so it is refused. This is
  -- different from an unmatched ORIGINAL: the link is required to know what is being
  -- withdrawn at all, and without it the row would be an orphan by construction rather
  -- than by accident.
  if p_reverses_event_id is null or btrim(p_reverses_event_id) = '' then
    raise exception
      'record_provider_reversal_conversion: the withdrawn transaction id is required'
      using errcode = 'not_null_violation';
  end if;

  select c.id into v_existing
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.provider_event_id = p_provider_event_id;

  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'isDuplicate', true, 'matched', false);
  end if;

  -- Resolve the original BEFORE inserting, so the two rows land together.
  --
  -- Scoped by provider id, so a crafted p_reverses_event_id can only ever name a
  -- conversion belonging to the same vendor. A NULL result is recorded, not raised -
  -- see the note above.
  select c.id into v_reverses
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.provider_event_id = btrim(p_reverses_event_id);

  begin
    insert into app.provider_conversions (
      provider_id, callback_id, provider_event_id, source_type, campaign_ref,
      user_id, tracking_id, event_type, status, gross_value_minor, currency,
      event_timestamp, normalized_payload, correlation_id, reverses_conversion_id
    )
    values (
      p_provider_id, p_callback_id, p_provider_event_id,
      p_source_type::app.provider_source_type, p_campaign_ref,
      -- The reversal INHERITS no user. It withdraws a conversion; it does not attribute
      -- a new one, and a reversal carrying a user_id would be a second attribution of
      -- the same click.
      null, null, p_event_type,
      'REVERSED'::app.conversion_status, p_gross_value_minor, p_currency,
      p_event_timestamp, coalesce(p_normalized_payload, '{}'::jsonb), p_correlation_id,
      v_reverses
    )
    returning id into v_id;
  exception
    when unique_violation then
      select c.id into v_existing
      from app.provider_conversions c
      where c.provider_id = p_provider_id
        and c.provider_event_id = p_provider_event_id;

      if v_existing is null then
        -- A different constraint failed, so the original error is the honest one.
        raise;
      end if;

      return jsonb_build_object('id', v_existing, 'isDuplicate', true, 'matched', false);
  end;

  return jsonb_build_object(
    'id', v_id,
    'isDuplicate', false,
    -- Whether an original was found. False is the expected outcome while no provider is
    -- LIVE, and the caller reports it rather than treating it as a failure.
    'matched', v_reverses is not null
  );
end;
$$;
revoke all on function app_private.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) from public, anon, authenticated;

grant execute on function app_private.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) to service_role;

comment on function app_private.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) is
  'Records one provider reversal and returns {"id": uuid, "isDuplicate": boolean, '
  '"matched": boolean}. p_reverses_event_id is the PROVIDER''s id for the transaction '
  'being withdrawn, resolved to a conversion in the same transaction as the insert and '
  'scoped by provider. An unmatched reversal is RECORDED with a NULL link rather than '
  'refused, so a withdrawal is never silently dropped. A replay returns the existing '
  'row. Creates no reward and moves no money; apply_provider_reversal does that.';


-- ACTS ON A RECORDED REVERSAL BY MOVING THE MONEY BACK.
--
-- `reverse_conversion` (migration 015) already reverses a reward and marks its
-- conversion REVERSED, and it is idempotent. What was missing is the step that decides
-- WHICH conversion a provider's status -2 refers to, and that refuses to act on a
-- reversal that has not been recorded. That decision belongs here, in SQL, where the
-- link is authoritative - not in TypeScript, where a missing link would be
-- indistinguishable from a lost response.
--
-- RETURNING A REASON RATHER THAN RAISING is what lets an operator distinguish the
-- ordinary cases from a genuine failure. A raise here would be swallowed by the
-- callback route and would look identical to the silent-discard defect this migration
-- exists to fix.
create or replace function app_private.apply_provider_reversal(
  p_reversal_conversion_id uuid,
  p_reason_code text,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_reversal app.provider_conversions;
  v_original app.provider_conversions;
  v_reversed_reward app.rewards;
begin
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'apply_provider_reversal: a reason code is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_reversal
  from app.provider_conversions
  where id = p_reversal_conversion_id
  for update;

  if not found then
    raise exception 'apply_provider_reversal: unknown reversal conversion %',
      p_reversal_conversion_id using errcode = 'foreign_key_violation';
  end if;

  -- A ROW THAT IS NOT A REVERSAL IS A CALLER ERROR, refused rather than quietly treated
  -- as a no-op. Handing this an ordinary completion would otherwise report 'reversed'
  -- for a conversion that was never withdrawn.
  if v_reversal.reverses_conversion_id is null then
    raise exception 'apply_provider_reversal: conversion % is not a reversal',
      p_reversal_conversion_id using errcode = 'check_violation';
  end if;

  select * into v_original
  from app.provider_conversions
  where id = v_reversal.reverses_conversion_id
  for update;

  if not found then
    -- Cannot happen while the FK holds, and the FK is ON DELETE RESTRICT. Asserted
    -- rather than assumed, so relaxing that clause cannot turn a missing original into a
    -- silent success.
    raise exception 'apply_provider_reversal: reversal % names a missing original',
      p_reversal_conversion_id using errcode = 'foreign_key_violation';
  end if;

  -- THE NORMAL CASE WHILE NO PROVIDER IS LIVE.
  --
  -- The provider is CANDIDATE, so no conversion was ever converted into a reward and
  -- there is nothing to take back. That is a legitimate state, not an error, and it must
  -- not be reported as a failure.
  if v_original.reward_id is null then
    insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values (
      'provider.reversal_no_reward', 'provider_conversion', v_original.id::text,
      jsonb_build_object(
        'reversalConversionId', p_reversal_conversion_id,
        'originalConversionId', v_original.id,
        'reasonCode', p_reason_code
      )
    ) on conflict do nothing;

    return jsonb_build_object('outcome', 'no_reward', 'originalId', v_original.id);
  end if;

  -- Idempotent replay. reverse_conversion already returns the existing reward when the
  -- conversion is REVERSED, so calling it twice cannot double-reverse; this branch
  -- exists so the caller is told which case it hit.
  if v_original.status = 'REVERSED' then
    return jsonb_build_object(
      'outcome', 'reversed',
      'originalId', v_original.id,
      'rewardId', v_original.reward_id,
      'alreadyReversed', true
    );
  end if;

  -- Routes through reverse_reward, so the original reward keeps its history and the
  -- reversal is a compensating entry (law 7). Never a deletion, never an edit.
  v_reversed_reward := app_private.reverse_conversion(
    p_conversion_id => v_original.id,
    p_reason_code => p_reason_code,
    p_actor_id => p_actor_id,
    p_correlation_id => p_correlation_id
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'provider.conversion_reversed', 'provider_conversion', v_original.id::text,
    jsonb_build_object(
      'reversalConversionId', p_reversal_conversion_id,
      'originalConversionId', v_original.id,
      'rewardId', v_original.reward_id,
      'providerId', v_original.provider_id,
      'reasonCode', p_reason_code,
      'rewardState', v_reversed_reward.state::text
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    v_original.user_id, 'provider.conversion_reversed', 'provider_conversion',
    v_original.id::text, 'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'reversalConversionId', p_reversal_conversion_id,
      'reasonCode', p_reason_code,
      'conversionState', 'REVERSED',
      'rewardState', v_reversed_reward.state::text
    )
  );

  return jsonb_build_object(
    'outcome', 'reversed',
    'originalId', v_original.id,
    'rewardId', v_original.reward_id,
    'alreadyReversed', false
  );
end;
$$;

revoke all on function app_private.apply_provider_reversal(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.apply_provider_reversal(uuid, text, uuid, uuid)
  to service_role;

comment on function app_private.apply_provider_reversal(uuid, text, uuid, uuid) is
  'Acts on a recorded reversal row: resolves its original, and reverses the reward '
  'through reverse_conversion when one exists. Returns {"outcome": "reversed" | '
  '"no_reward", "originalId": uuid, ...}. Refuses a row that is not a reversal. Never '
  'deletes and never rewrites the original conversion (law 7).';