-- =============================================================================
-- Averra migration 052: Referral reward funding path and the referrer cap
--
-- Spec: the V1 referral programme (reward ₦500, qualification ₦5,000, per-referrer
--       cap 100), 71_ARCHITECTURAL_LAWS.md laws 8, 10 and 56.
--
-- WHAT THIS DOES NOT DO
--
-- It does not fund anything. The promotional reward source is created INACTIVE with
-- a ZERO budget, so this migration cannot commit money to the programme even by
-- accident. Funding is a separate, explicit call that takes a budget value the
-- operator has chosen, because a referral programme is a liability and saying so
-- with a number is the owner's decision, not a migration author's.
--
-- The qualification engine (CR-0025) is deliberately UNTOUCHED here. The threshold,
-- the reward amount, the signed ledger, the net-of-withdrawals calculation and the
-- no-clawback behaviour after QUALIFIED are all exactly as shipped.
--
-- reward_referral (migration 024) IS NOT MODIFIED. It is already applied and
-- reviewed. The cap lives in a NEW wrapper that checks and then delegates, because a
-- re-typed function body is how this repository has corrupted SQL before, and
-- because the cap is a policy layer rather than a change to the reward mechanic.
--
-- WHY NO CLAWBACK
--
-- QUALIFIED -> ATTRIBUTED after the fact is not implemented, deliberately. The
-- owner considered it and rejected it: once a reward may have been paid, un-qualifying
-- is a financial history rewrite. A later withdrawal reduces
-- `qualified_value_minor` and the status stays QUALIFIED. If stronger anti-fraud
-- economics are ever wanted, the answer is a HOLD PERIOD BEFORE PAYOUT, not a
-- retroactive reversal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The per-referrer cap
-- -----------------------------------------------------------------------------
-- 100 successful referrals = a maximum ₦50,000 exposure per referrer at ₦500 each.
-- Seeded as configuration so it can be changed without a code change, and read
-- through the typed bigint reader rather than parsed inline.
insert into app.system_config (key, value, description) values
  ('maximum_rewards_per_referrer', '100',
   'Cap on REWARDED referrals per referrer. A cost-control mechanism, not an identity check. Absent means unlimited.')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- The promotional reward source: created INACTIVE and UNFUNDED
-- -----------------------------------------------------------------------------
-- `reward_sources` is law 10's answer to "no reward without a traceable funding
-- source". Creating the row here means the SOURCE_TYPE is validated by the database
-- and `reward_referral` has something to name - but with a zero budget and
-- `is_active = false`, so `grant_reward` still refuses to pay. Nothing is funded by
-- this migration.
--
-- It is explicitly NOT user money. `AVERRA_PROMOTIONAL` is a distinct source_type
-- from `PROVIDER` and `ADVERTISER` precisely so a referral payout can never be
-- mistaken for, or drawn from, a provider budget or a user balance.
insert into app.reward_sources (
  source_type, name, currency_unit, budget_total_minor, budget_remaining_minor, is_active
) values (
  'AVERRA_PROMOTIONAL', 'Referral programme', 'NGN-kobo', 0, 0, false
)
on conflict do nothing;

comment on table app.reward_sources is
  'Traceable funding source for every reward (law 10). The AVERRA_PROMOTIONAL row for referrals is created UNFUNDED and inactive by migration 052; see app_private.fund_promotional_reward_source.';

-- -----------------------------------------------------------------------------
-- fund_promotional_reward_source: the ONLY way money enters this programme
-- -----------------------------------------------------------------------------
-- Takes the budget as an explicit parameter, refuses zero or negative, and activates
-- the row. An operator calls this with a number THEY chose; nothing in a migration
-- supplies it.
--
-- `budget_remaining_minor` is set equal to the total on first funding so the source
-- is immediately usable. Re-funding later tops the remaining balance up, and is
-- logged to `audit_events` because adding liability to a live programme is a
-- financial action that must be attributable (law 27).
create or replace function app_private.fund_promotional_reward_source(
  p_budget_minor bigint,
  p_actor_id uuid default null
)
returns app.reward_sources
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_source app.reward_sources;
  v_existing_total bigint;
begin
  if p_budget_minor is null or p_budget_minor <= 0 then
    -- Refusing rather than defaulting: a zero budget here would look like a
    -- funded programme that cannot pay, which is the worst of both states.
    raise exception 'fund_promotional_reward_source: budget must be positive'
      using errcode = 'check_violation';
  end if;

  select * into v_source from app.reward_sources
  where source_type = 'AVERRA_PROMOTIONAL'
  for update;

  if not found then
    raise exception 'fund_promotional_reward_source: no AVERRA_PROMOTIONAL source exists'
      using errcode = 'no_data_found';
  end if;

  v_existing_total := v_source.budget_total_minor;

  update app.reward_sources
  set budget_total_minor     = budget_total_minor + p_budget_minor,
      budget_remaining_minor = budget_remaining_minor + p_budget_minor,
      is_active              = true,
      updated_at             = now()
  where id = v_source.id
  returning * into v_source;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, after_state
  ) values (
    p_actor_id,
    'referral.budget_funded',
    'reward_source',
    v_source.id::text,
    format('+%s minor units', p_budget_minor),
    'SUCCESS',
    jsonb_build_object(
      'previousTotal', v_existing_total,
      'newTotal', v_source.budget_total_minor,
      'newRemaining', v_source.budget_remaining_minor
    )
  );

  return v_source;
end;
$$;

revoke all on function app_private.fund_promotional_reward_source(bigint, uuid) from public, anon, authenticated;
grant execute on function app_private.fund_promotional_reward_source(bigint, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- pay_referral_reward: the ONLY path that pays a referral
-- -----------------------------------------------------------------------------
-- `reward_referral` (migration 024) is left exactly as applied. This wrapper layers
-- the two policies that belong to the programme rather than to the mechanic:
--
--   1. THE PER-REFERRER CAP. A referrer who has already been paid
--      `maximum_rewards_per_referrer` times earns nothing further, even if another
--      referral qualifies. This is COST CONTROL, not identity: it does not decide
--      who is legitimate, it bounds the exposure.
--
--   2. THE PROMOTIONAL SOURCE. The reward is always drawn from the
--      AVERRA_PROMOTIONAL source, never from a provider budget and never from user
--      money (law 56). The source is resolved here rather than passed in, so no
--      caller can name a different one.
--
-- Idempotency: `reward_referral` already returns early when the referral is
-- REWARDED, and `grant_reward` is keyed on `referral-reward:<referral id>`. Two
-- independent guards, and the cap check is placed AFTER the status check so a
-- repeat call on an already-paid referral is a no-op rather than a cap error.
create or replace function app_private.pay_referral_reward(
  p_referral_id uuid,
  p_unit text default null,
  p_correlation_id uuid default null
)
returns app.referrals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_referral app.referrals;
  v_source app.reward_sources;
  v_unit text;
  v_amount bigint;
  v_cap bigint;
  v_paid_count bigint;
begin
  select * into v_referral from app.referrals r where r.id = p_referral_id for update;

  if not found then
    raise exception 'pay_referral_reward: unknown referral'
      using errcode = 'foreign_key_violation';
  end if;

  -- Already paid: idempotent, and explicitly checked BEFORE the cap so a retry
  -- cannot be reported as "cap reached", which would be a confusing way to learn
  -- that the reward already exists.
  if v_referral.status = 'REWARDED' then
    return v_referral;
  end if;

  -- The referrer's unit follows the source, so the amount can never be paid in the
  -- wrong denomination.
  select s.* into v_source from app.reward_sources s
  where s.source_type = 'AVERRA_PROMOTIONAL' and s.is_active
  for update;

  if not found then
    raise exception 'pay_referral_reward: the referral programme is not funded'
      using errcode = 'foreign_key_violation';
  end if;

  v_unit := coalesce(p_unit, v_source.currency_unit);

  if v_unit is distinct from v_source.currency_unit then
    raise exception 'pay_referral_reward: unit % does not match the programme unit %',
      v_unit, v_source.currency_unit
      using errcode = 'datatype_mismatch';
  end if;

  -- THE CAP. Absent means unlimited, which is why the default is 0 rather than 100:
  -- a default would silently impose a limit nobody chose.
  v_cap := app_private.system_config_bigint('maximum_rewards_per_referrer', 0);

  if v_cap > 0 then
    select count(*) into v_paid_count from app.referrals r
    where r.referrer_user_id = v_referral.referrer_user_id
      and r.status = 'REWARDED';

    if v_paid_count >= v_cap then
      raise exception 'pay_referral_reward: this referrer has reached the maximum of % rewards', v_cap
        using errcode = 'check_violation';
    end if;
  end if;

  v_amount := app_private.system_config_bigint('referral_reward_minor', 0);

  if v_amount <= 0 then
    raise exception 'pay_referral_reward: no reward amount is configured'
      using errcode = 'check_violation';
  end if;

  return app_private.reward_referral(
    v_referral.id,
    v_source.id,
    v_amount,
    v_unit,
    p_correlation_id
  );
end;
$$;

revoke all on function app_private.pay_referral_reward(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app_private.pay_referral_reward(uuid, text, uuid) to service_role;

-- Public entry point for an operator action. There is deliberately NO wrapper that
-- a signed-in USER could call: paying a referral is a financial action reserved for
-- the service role, and the reward amount is never taken from the client (law 56).
create or replace function public.pay_referral_reward(
  p_referral_id uuid,
  p_unit text default null,
  p_correlation_id uuid default null
)
returns app.referrals
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.pay_referral_reward(p_referral_id, p_unit, p_correlation_id);
$$;

revoke all on function public.pay_referral_reward(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.pay_referral_reward(uuid, text, uuid) to service_role;