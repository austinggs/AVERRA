-- =============================================================================
-- Averra migration 015: Provider conversion to reward bridge
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt FINANCIAL BOUNDARY,
--                  35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 1/5/6/10/16
--
-- Doc 08 is unambiguous: "A callback does not directly write the wallet. It
-- produces a validated business event consumed by the reward engine."
--
-- This function is that bridge, and it is the ONLY place a provider event
-- becomes money. It refuses unless the conversion is VALIDATED, resolves to a
-- user, belongs to a LIVE provider and names a funding source; then it calls
-- grant_reward, never post_ledger_entry. It is idempotent on p_conversion_id.
-- =============================================================================

create or replace function app_private.apply_conversion_reward(
  p_conversion_id uuid,
  p_source_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_conversion app.provider_conversions;
  v_provider app.providers;
  v_reward app.rewards;
  v_amount bigint;
  v_unit text;
begin
  select * into v_conversion
  from app.provider_conversions
  where id = p_conversion_id
  for update;

  if not found then
    raise exception 'apply_conversion_reward: unknown conversion %', p_conversion_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent replay: the conversion already carries its reward.
  if v_conversion.reward_id is not null then
    select * into v_reward from app.rewards where id = v_conversion.reward_id;
    if found then
      return v_reward;
    end if;
  end if;

  -- Only a VALIDATED conversion may become money. A REJECTED, REVERSED or
  -- CHARGEBACK conversion must not be paid.
  if v_conversion.status <> 'VALIDATED' then
    raise exception 'apply_conversion_reward: conversion status is %, expected VALIDATED',
      v_conversion.status using errcode = 'check_violation';
  end if;

  -- The provider's own lifecycle gate. A SUSPENDED provider pays nothing.
  select * into v_provider from app.providers where id = v_conversion.provider_id;

  if not found then
    raise exception 'apply_conversion_reward: conversion has no provider'
      using errcode = 'foreign_key_violation';
  end if;

  if v_provider.lifecycle_state <> 'LIVE' then
    raise exception 'apply_conversion_reward: provider is %, not LIVE', v_provider.lifecycle_state
      using errcode = 'check_violation';
  end if;

  -- An unattributed conversion cannot be paid. Rewarding a null user would
  -- create money nobody can ever withdraw.
  if v_conversion.user_id is null then
    raise exception 'apply_conversion_reward: conversion has no resolved user'
      using errcode = 'check_violation';
  end if;

  v_amount := v_conversion.gross_value_minor;
  v_unit := v_conversion.currency;

  if v_amount is null or v_amount <= 0 then
    raise exception 'apply_conversion_reward: conversion carries no positive amount'
      using errcode = 'check_violation';
  end if;

  if v_unit is null or length(trim(v_unit)) = 0 then
    raise exception 'apply_conversion_reward: conversion carries no currency'
      using errcode = 'check_violation';
  end if;

  if p_source_id is null then
    raise exception 'apply_conversion_reward: a funding source is required (law 10)'
      using errcode = 'null_value_not_allowed';
  end if;

  -- THE ONLY PATH TO MONEY. grant_reward validates the funding source, decrements
  -- the budget in the same transaction, applies caps, and posts the ledger entry.
  v_reward := app_private.grant_reward(
    p_user_id => v_conversion.user_id,
    p_source_id => p_source_id,
    p_amount_minor => v_amount,
    p_unit => v_unit,
    p_event_type => 'PROVIDER_CONVERSION',
    -- The provider event id is the natural idempotency key, so the same
    -- provider event can never produce two rewards (law 5).
    p_source_event_id => v_conversion.provider_event_id,
    p_gross_value_minor => v_conversion.gross_value_minor,
    p_rule_reference => 'provider_conversion:' || v_conversion.source_type::text,
    p_idempotency_key => 'provider-reward:' || v_conversion.provider_id::text
      || ':' || v_conversion.provider_event_id,
    p_correlation_id => p_correlation_id,
    -- Doc 30: a provider conversion is a liability, not immediately spendable
    -- money. It settles via transition_reward once settlement is confirmed.
    p_hold => false
  );

  update app.provider_conversions
  set reward_id = v_reward.id,
      status = 'CONVERTED',
      reward_rule_reference = 'provider_conversion:' || v_conversion.source_type::text
  where id = p_conversion_id;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'provider.conversion_rewarded', 'provider_conversion', p_conversion_id::text,
    jsonb_build_object(
      'conversionId', p_conversion_id, 'rewardId', v_reward.id,
      'providerId', v_conversion.provider_id, 'amountMinor', v_amount, 'unit', v_unit
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    v_conversion.user_id, 'provider.conversion_rewarded', 'provider_conversion',
    p_conversion_id::text, 'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'rewardId', v_reward.id, 'amountMinor', v_amount, 'unit', v_unit,
      'providerId', v_conversion.provider_id, 'state', v_reward.state::text
    )
  );

  return v_reward;
end;
$$;

-- A provider reversal is a COMPENSATING reward event, never a deletion.
-- It routes through reverse_reward so the original reward keeps its history
-- (law 7, doc 13 REVERSALS).
create or replace function app_private.reverse_conversion(
  p_conversion_id uuid,
  p_reason_code text,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_conversion app.provider_conversions;
  v_reversal app.rewards;
begin
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'reverse_conversion: a reason code is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_conversion
  from app.provider_conversions
  where id = p_conversion_id
  for update;

  if not found then
    raise exception 'reverse_conversion: unknown conversion %', p_conversion_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_conversion.reward_id is null then
    raise exception 'reverse_conversion: conversion has no reward to reverse'
      using errcode = 'check_violation';
  end if;

  if v_conversion.status = 'REVERSED' then
    select * into v_reversal from app.rewards where id = v_conversion.reward_id;
    return v_reversal;
  end if;

  v_reversal := app_private.reverse_reward(
    p_reward_id => v_conversion.reward_id,
    p_reason_code => p_reason_code,
    p_actor_id => p_actor_id,
    p_correlation_id => p_correlation_id
  );

  update app.provider_conversions
  set status = 'REVERSED'
  where id = p_conversion_id;

  return v_reversal;
end;
$$;

revoke all on function app_private.apply_conversion_reward(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.reverse_conversion(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.apply_conversion_reward(uuid, uuid, uuid) to service_role;
grant execute on function app_private.reverse_conversion(uuid, text, uuid, uuid) to service_role;