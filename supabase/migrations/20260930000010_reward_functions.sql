-- =============================================================================
-- Averra migration 010: Reward engine commands
--
-- Source of truth: 35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt,
--                  30_MINING_GAME_REWARDS.txt, 71_ARCHITECTURAL_LAWS.md,
--                  docs/adr/0001-financial-authority.md
--
-- Processing order from doc 35 PROCESSING:
--   validate funding source -> normalise amount -> apply rule -> check budget and
--   caps -> apply hold policy -> create immutable ledger entry -> emit event.
--
-- The engine creates a PENDING reward. It does NOT credit a spendable balance.
-- A PENDING reward becomes AVAILABLE only after settlement or provider
-- confirmation, and only then does it become withdrawable (law 6).
-- =============================================================================

-- Grants a reward from a verified business event.
create or replace function app_private.grant_reward(
  p_user_id uuid,
  p_source_id uuid,
  p_amount_minor bigint,
  p_unit text,
  p_event_type text,
  p_source_event_id text,
  p_gross_value_minor bigint default null,
  p_rule_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_hold boolean default false
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_source app.reward_sources;
  v_reward app.rewards;
  v_earned uuid;
  v_key text;
  v_cap bigint;
  v_spent bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'grant_reward: amount must be positive'
      using errcode = 'check_violation';
  end if;

  if p_source_event_id is null or length(trim(p_source_event_id)) = 0 then
    raise exception 'grant_reward: a source event id is required'
      using errcode = 'null_value_not_allowed';
  end if;

  v_key := coalesce(
    p_idempotency_key,
    'reward:' || p_event_type || ':' || p_source_event_id
  );

  -- Idempotent replay. The same source event always yields the same reward.
  select * into v_reward from app.rewards where idempotency_key = v_key;
  if found then
    return v_reward;
  end if;

  -- law 10: a reward must have a live, traceable funding source.
  select * into v_source
  from app.reward_sources
  where id = p_source_id and is_active
  for update;

  if not found then
    raise exception 'grant_reward: unknown or inactive reward source %', p_source_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_source.currency_unit <> p_unit then
    raise exception 'grant_reward: unit % does not match source unit %', p_unit, v_source.currency_unit
      using errcode = 'datatype_mismatch';
  end if;

  -- law 1: no unbacked balance. The budget must cover this reward.
  if v_source.budget_remaining_minor < p_amount_minor then
    raise exception 'grant_reward: insufficient budget remaining on source % (have %, need %)',
      p_source_id, v_source.budget_remaining_minor, p_amount_minor
      using errcode = 'check_violation';
  end if;

-- doc 30 CAPS: a per-user ceiling, enforced before anything is written.
  select cap_amount_minor into v_cap
  from app.reward_caps
  where is_active
    and cap_type = 'PER_USER_TOTAL'
    and (
      (scope = 'USER' and scope_reference = p_user_id::text)
      or (scope = 'GLOBAL' and scope_reference is null)
    )
  order by cap_amount_minor
  limit 1;

  if v_cap is not null then
    select coalesce(sum(r.amount_minor), 0) into v_spent
    from app.rewards r
    where r.user_id = p_user_id
      and r.unit = p_unit
      and r.state not in ('REVERSED','CANCELLED','EXPIRED');

    if v_spent + p_amount_minor > v_cap then
      raise exception 'grant_reward: per-user cap exceeded (cap %, would reach %)',
        v_cap, v_spent + p_amount_minor using errcode = 'check_violation';
    end if;
  end if;

  insert into app.rewards (
    user_id, source_id, state, amount_minor, unit,
    event_type, source_event_id, gross_value_minor, rule_reference,
    idempotency_key, correlation_id
  ) values (
    p_user_id, p_source_id,
    case when p_hold then 'ON_HOLD'::app.reward_state else 'PENDING'::app.reward_state end,
    p_amount_minor, p_unit, p_event_type, p_source_event_id,
    p_gross_value_minor, p_rule_reference, v_key, p_correlation_id
  )
  returning * into v_reward;

  insert into app.reward_state_transitions (reward_id, from_state, to_state, reason_code)
  values (v_reward.id, null, v_reward.state,
    case when p_hold then 'RISK_HOLD' else 'VERIFIED_EVENT' end);

  -- The budget is decremented in the SAME transaction as the reward, so the
  -- spend can never be lost and the reward can never be unbacked.
  update app.reward_sources
  set budget_remaining_minor = budget_remaining_minor - p_amount_minor
  where id = p_source_id;

  -- An immutable ledger entry exists from the moment the reward exists (law 2).
  -- PENDING is a liability that is not yet withdrawable; the wallet view is what
  -- distinguishes the two, not the ledger.
  v_earned := app_private.get_or_create_account(p_user_id, 'EARNED_REWARD', p_unit);

  perform app_private.post_ledger_entry(
    v_earned, 'CREDIT', p_amount_minor, p_unit,
    'REWARD_EARNED', v_reward.id::text, v_key || ':ledger', p_correlation_id,
    jsonb_build_object(
      'rewardId', v_reward.id, 'eventType', p_event_type,
      'sourceEventId', p_source_event_id, 'sourceId', p_source_id,
      'ruleReference', p_rule_reference, 'state', v_reward.state::text
    )
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'reward.granted', 'reward', v_reward.id::text,
    jsonb_build_object(
      'rewardId', v_reward.id, 'userId', p_user_id, 'amountMinor', p_amount_minor,
      'unit', p_unit, 'state', v_reward.state::text, 'sourceId', p_source_id
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    p_user_id, 'reward.granted', 'reward', v_reward.id::text, 'SUCCESS', p_correlation_id,
    jsonb_build_object('amountMinor', p_amount_minor, 'unit', p_unit, 'state', v_reward.state::text)
  );

  return v_reward;
end;
$$;

-- Moves a reward through its lifecycle. PENDING -> AVAILABLE is the settlement
-- step; AVAILABLE -> ON_HOLD is the risk step.
--
-- Every transition is appended to reward_state_transitions, so the reward's
-- history is reconstructable and nothing is overwritten.
create or replace function app_private.transition_reward(
  p_reward_id uuid,
  p_to_state app.reward_state,
  p_reason_code text default null,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_reward app.rewards;
  v_from app.reward_state;
begin
  select * into v_reward from app.rewards where id = p_reward_id for update;
  if not found then
    raise exception 'transition_reward: unknown reward %', p_reward_id
      using errcode = 'foreign_key_violation';
  end if;

  v_from := v_reward.state;

  if p_to_state = v_from then
    return v_reward;
  end if;

  -- Terminal states are final. Nothing resurrects a reversed reward.
  if v_from in ('REVERSED','CANCELLED','EXPIRED') then
    raise exception 'transition_reward: reward is already terminal (%)', v_from
      using errcode = 'check_violation';
  end if;

  -- A reversal must go through reverse_reward, which posts the compensating
  -- ledger entry. A bare transition here would mark a reward reversed without
  -- the money ever being compensated (law 7).
  if p_to_state in ('REVERSED','CHARGEBACK') then
    raise exception 'transition_reward: use reverse_reward for a reversing transition'
      using errcode = 'check_violation';
  end if;

  update app.rewards
  set state = p_to_state, state_changed_at = now()
  where id = p_reward_id
  returning * into v_reward;

  insert into app.reward_state_transitions (reward_id, from_state, to_state, reason_code, actor_user_id)
  values (p_reward_id, v_from, p_to_state, p_reason_code, p_actor_id);

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'reward.state_changed', 'reward', p_reward_id::text,
    jsonb_build_object(
      'rewardId', p_reward_id, 'from', v_from::text,
      'to', p_to_state::text, 'reasonCode', p_reason_code
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, before_state, after_state
  ) values (
    p_actor_id, 'reward.state_changed', 'reward', p_reward_id::text, 'SUCCESS', p_correlation_id,
    jsonb_build_object('state', v_from::text),
    jsonb_build_object('state', p_to_state::text)
  );

  return v_reward;
end;
$$;

-- Reverses a reward as a COMPENSATING event.
--
-- The original reward row keeps its history and is marked REVERSED. A new
-- ledger entry debits the same amount. Nothing is deleted and no balance field
-- is edited (law 7, law 15, doc 36 REVERSALS).
create or replace function app_private.reverse_reward(
  p_reward_id uuid,
  p_reason_code text,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_reward app.rewards;
  v_earned uuid;
  v_reversal app.rewards;
  v_key text;
begin
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'reverse_reward: a reason code is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_reward from app.rewards where id = p_reward_id for update;
  if not found then
    raise exception 'reverse_reward: unknown reward %', p_reward_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_reward.state = 'REVERSED' then
    return v_reward;
  end if;

  if v_reward.state in ('CANCELLED','EXPIRED') then
    raise exception 'reverse_reward: reward is already terminal (%)', v_reward.state
      using errcode = 'check_violation';
  end if;

  v_key := 'reward-reversal:' || p_reward_id;

  select * into v_reversal from app.rewards where idempotency_key = v_key;
  if found then
    return v_reversal;
  end if;

  -- A compensating reward row, linked to what it reverses.
  insert into app.rewards (
    user_id, source_id, state, amount_minor, unit,
    event_type, source_event_id, rule_reference,
    idempotency_key, correlation_id, reverses_reward_id
  ) values (
    v_reward.user_id, v_reward.source_id, 'PENDING', v_reward.amount_minor, v_reward.unit,
    'REWARD_REVERSAL', v_reward.source_event_id, p_reason_code,
    v_key, p_correlation_id, p_reward_id
  )
  returning * into v_reversal;

  v_earned := app_private.get_or_create_account(
    v_reward.user_id, 'EARNED_REWARD', v_reward.unit
  );

  perform app_private.post_ledger_entry(
    v_earned, 'DEBIT', v_reward.amount_minor, v_reward.unit,
    'REWARD_REVERSED', v_reward.id::text, v_key || ':ledger', p_correlation_id,
    jsonb_build_object(
      'rewardId', v_reward.id, 'reversalId', v_reversal.id, 'reasonCode', p_reason_code
    )
  );

  update app.rewards set state = 'REVERSED', state_changed_at = now() where id = p_reward_id;
  update app.rewards set state = 'REVERSED', state_changed_at = now() where id = v_reversal.id;

  insert into app.reward_state_transitions (reward_id, from_state, to_state, reason_code, actor_user_id)
  values
    (p_reward_id, v_reward.state, 'REVERSED', p_reason_code, p_actor_id),
    (v_reversal.id, 'PENDING', 'REVERSED', p_reason_code, p_actor_id);

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'reward.reversed', 'reward', p_reward_id::text,
    jsonb_build_object(
      'rewardId', p_reward_id, 'reversalId', v_reversal.id,
      'userId', v_reward.user_id, 'amountMinor', v_reward.amount_minor, 'reasonCode', p_reason_code
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_actor_id, 'reward.reversed', 'reward', p_reward_id::text,
    p_reason_code, 'SUCCESS', p_correlation_id,
    jsonb_build_object('state', 'REVERSED', 'amountMinor', v_reward.amount_minor)
  );

  return v_reversal;
end;
$$;

-- Lock down execution. No browser-facing role may create or reverse a reward.
revoke all on function app_private.grant_reward(uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function app_private.transition_reward(uuid, app.reward_state, text, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.reverse_reward(uuid, text, uuid, uuid) from public, anon, authenticated;

grant execute on function app_private.grant_reward(uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean) to service_role;
grant execute on function app_private.transition_reward(uuid, app.reward_state, text, uuid, uuid) to service_role;
grant execute on function app_private.reverse_reward(uuid, text, uuid, uuid) to service_role;
