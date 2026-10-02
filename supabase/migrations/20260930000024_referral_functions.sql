-- =============================================================================
-- Averra migration 024: Referral commands
--
-- Source of truth: 39_REFERRAL_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md law 6, 8, 10
--
-- Doc 39 REWARD HANDLING: "Referral rewards route through Reward Engine and may
-- be pending/held/reversed." So `reward_referral` calls `grant_reward` and never
-- posts a ledger entry directly.
-- =============================================================================

-- Attributes a new account to a referrer. Doc 39 ATTRIBUTION.
--
-- The referee here is the user at sign-up. No reward is possible from this
-- function: the row is ATTRIBUTED and nothing more. Payment requires
-- `qualify_referral` and then `reward_referral`, both of which require a
-- server-recorded qualifying event.
create or replace function app_private.attribute_referral(
  p_referee_user_id uuid,
  p_code text,
  p_correlation_id uuid default null
) returns app.referrals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_code app.referral_codes;
  v_referral app.referrals;
begin
  select * into v_code
  from app.referral_codes
  where code = upper(trim(p_code)) and is_active
  for share;

  if not found then
    raise exception 'attribute_referral: unknown referral code'
      using errcode = 'check_violation';
  end if;

  -- Law 8, and doc 39 ANTI-ABUSE. A user referring themselves is refused here
  -- as well as by the table constraint: the constraint is the backstop for any
  -- other write path, and this is the friendly, specific failure.
  if v_code.user_id = p_referee_user_id then
    raise exception 'attribute_referral: a user cannot refer themselves'
      using errcode = 'check_violation';
  end if;

  -- Doc 39 ANTI-ABUSE: one referee, one referral. A retried attribution is a
  -- no-op rather than a second row.
  select * into v_referral from app.referrals where referee_user_id = p_referee_user_id;
  if found then
    return v_referral;
  end if;

  insert into app.referrals (code_id, referrer_user_id, referee_user_id, status, status_reason)
  values (v_code.id, v_code.user_id, p_referee_user_id, 'ATTRIBUTED', 'awaiting qualifying activity')
  returning * into v_referral;

  return v_referral;
end;
$$;

-- Doc 39 QUALIFICATION. Called by the server when the referee reaches the
-- configured threshold. The caller supplies a SERVER-RECORDED event id, which
-- is what makes the qualification auditable rather than self-asserted.
create or replace function app_private.qualify_referral(
  p_referral_id uuid,
  p_qualifying_event_id uuid,
  p_earned_minor bigint,
  p_correlation_id uuid default null
) returns app.referrals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_referral app.referrals;
  v_code app.referral_codes;
begin
  select * into v_referral from app.referrals where id = p_referral_id for update;

  if not found then
    raise exception 'qualify_referral: unknown referral'
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent. A repeated qualification is a no-op, not an error, because the
  -- caller may retry after a timeout.
  if v_referral.status in ('QUALIFIED','REWARDED') then
    return v_referral;
  end if;

  if v_referral.status = 'REJECTED' then
    raise exception 'qualify_referral: referral was rejected'
      using errcode = 'check_violation';
  end if;

  select * into v_code from app.referral_codes where id = v_referral.code_id;

  -- The threshold is SERVER configuration and the earnings figure is SERVER
  -- data. Neither comes from the client.
  if p_earned_minor < v_code.qualification_threshold_minor then
    raise exception 'qualify_referral: earned % is below the threshold %',
      p_earned_minor, v_code.qualification_threshold_minor
      using errcode = 'check_violation';
  end if;

  update app.referrals
  set status = 'QUALIFIED',
      qualifying_event_id = p_qualifying_event_id,
      qualified_at = now(),
      status_reason = 'qualified, awaiting reward'
  where id = p_referral_id
  returning * into v_referral;

  return v_referral;
end;
$$;

-- Doc 39 REWARD HANDLING. Routes through the Reward Engine (law 10), never
-- post_ledger_entry.
--
-- Idempotent: a retried reward returns the existing reward rather than paying
-- twice. The reward's source event id is the referral id, so the Reward Engine's
-- own idempotency also protects this path.
create or replace function app_private.reward_referral(
  p_referral_id uuid,
  p_source_id uuid,
  p_amount_minor bigint,
  p_unit text,
  p_correlation_id uuid default null
) returns app.referrals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_referral app.referrals;
  v_reward app.rewards;
begin
  select * into v_referral from app.referrals where id = p_referral_id for update;

  if not found then
    raise exception 'reward_referral: unknown referral'
      using errcode = 'foreign_key_violation';
  end if;

  -- A referral pays at most once.
  if v_referral.status = 'REWARDED' then
    return v_referral;
  end if;

  -- Doc 39 QUALIFICATION. The constraint on the table enforces this too; the
  -- explicit check here gives a clear reason rather than a constraint failure.
  if v_referral.status <> 'QUALIFIED' then
    raise exception 'reward_referral: referral is %, not QUALIFIED', v_referral.status
      using errcode = 'check_violation';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'reward_referral: amount must be positive'
      using errcode = 'check_violation';
  end if;

  -- The ONE money path. Funding source, budget decrement, caps and the ledger
  -- entry all come from grant_reward.
  v_reward := app_private.grant_reward(
    p_user_id => v_referral.referrer_user_id,
    p_source_id => p_source_id,
    p_amount_minor => p_amount_minor,
    p_unit => p_unit,
    p_event_type => 'REFERRAL_QUALIFIED',
    p_source_event_id => v_referral.id::text,
    p_gross_value_minor => p_amount_minor,
    p_rule_reference => 'referral:qualified',
    p_idempotency_key => 'referral-reward:' || v_referral.id::text,
    p_correlation_id => p_correlation_id,
    -- Doc 39: a referral reward may be held or reversed. Granting it on hold
    -- means it arrives as pending/eligible, not instantly settled.
    p_hold => false
  );

  update app.referrals
  set status = 'REWARDED',
      reward_id = v_reward.id,
      reward_source_id = p_source_id,
      status_reason = 'reward created'
  where id = p_referral_id
  returning * into v_referral;

  return v_referral;
end;
$$;

revoke all on function app_private.attribute_referral(uuid, text, uuid) from public, anon, authenticated;
revoke all on function app_private.qualify_referral(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function app_private.reward_referral(uuid, uuid, bigint, text, uuid) from public, anon, authenticated;

grant execute on function app_private.attribute_referral(uuid, text, uuid) to service_role;
grant execute on function app_private.qualify_referral(uuid, uuid, bigint, uuid) to service_role;
grant execute on function app_private.reward_referral(uuid, uuid, bigint, text, uuid) to service_role;