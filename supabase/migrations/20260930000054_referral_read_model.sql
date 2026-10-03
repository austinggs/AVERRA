-- =============================================================================
-- Averra migration 054: Referral read model for the UI, and admin monitoring
--
-- Spec: 39_REFERRAL_SYSTEM.txt (TRANSPARENCY), doc 87 section 12 (Reviews &
--       Community) and the operational referral view, law 39 TRANSPARENCY.
--
-- WHY A NEW FILE RATHER THAN EDITING MIGRATION 030
--
-- `public.get_referral_overview` was written before the programme was switched on,
-- when a referral had exactly two visible facts: a code and a status. It now needs
-- progress toward the threshold and a reward history, because a user who has been
-- referred somebody and sees nothing happening has no way to know whether the
-- system is working.
--
-- Migration 030 is applied and reviewed. `create or replace` here supersedes the
-- body without re-typing it in place, which is how function bodies get corrupted in
-- this repository. The SIGNATURE is unchanged, so every existing caller keeps
-- working.
--
-- WHAT IS NOT EXPOSED
--
-- No risk signal, no referral counterparty identity, no internal moderation note,
-- and no budget figure. Doc 39 TRANSPARENCY requires the user to see status and
-- reason "without seeing sensitive risk signals", and the reliable way to keep a
-- signal out of a read is to never query it.
-- =============================================================================

create or replace function public.get_referral_overview(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'code', (select c.code from app.referral_codes c where c.user_id = p_user_id),
    'thresholdMinor', (
      select c.qualification_threshold_minor from app.referral_codes c where c.user_id = p_user_id
    ),
    'isActive', coalesce((
      select c.is_active from app.referral_codes c where c.user_id = p_user_id
    ), false),
    -- Programme economics are configuration, and showing the user what a referral
    -- is worth is honest. These are NOT secrets: they are the terms of the offer.
    'programmeOpen', app_private.system_config_bool('referral_programme_open', false),
    'rewardMinor', app_private.system_config_bigint('referral_reward_minor', 0),
    -- The unit the amounts above are denominated in. Sourced from the reward
    -- source rather than hardcoded, so the UI can never label an amount with a
    -- different unit from the one it will be paid in.
    'unit', coalesce((
      select s.currency_unit from app.reward_sources s where s.source_type = 'AVERRA_PROMOTIONAL'
    ), 'NGN-kobo'),
    'counts', jsonb_build_object(
      'total', count(*),
      'qualified', count(*) filter (where r.status = 'QUALIFIED'),
      'rewarded', count(*) filter (where r.status = 'REWARDED')
    ),
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r2.id,
        'status', r2.status,
        'reason', r2.status_reason,
        -- Progress toward the threshold, so a user can see it approaching. It is
        -- the NET after withdrawals, which is what actually counts, so showing the
        -- gross instead would be a lie by omission.
        'qualifiedValueMinor', r2.qualified_value_minor,
        'qualifiedAt', r2.qualified_at,
        'createdAt', r2.created_at
      ) order by r2.created_at desc)
      from (
        select id, status, status_reason, qualified_at, created_at, qualified_value_minor
        from app.referrals
        where referrer_user_id = p_user_id
        order by created_at desc
        limit 50
      ) r2
    ), '[]'::jsonb),
    -- What the user actually earned from referrals, by reward. Joined only to the
    -- reward the referral created, so this cannot be widened into a balance read.
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'referralId', r3.id,
        'rewardId', rw.id,
        'amountMinor', rw.amount_minor,
        'unit', rw.unit,
        -- The reward state, so the UI can say "pending" rather than implying the
        -- money is withdrawable now (doc 09 TRANSPARENCY).
        'state', rw.state,
        'createdAt', rw.created_at
      ) order by rw.created_at desc)
      from app.referrals r3
      join app.rewards rw on rw.id = r3.reward_id
      where r3.referrer_user_id = p_user_id
      limit 50
    ), '[]'::jsonb)
  )
  from app.referrals r
  where r.referrer_user_id = p_user_id;
$$;

revoke all on function public.get_referral_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_referral_overview(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Admin referral monitoring
-- -----------------------------------------------------------------------------
-- One row of programme health, for an operator (doc 87). Counts across the whole
-- programme, NOT the caller's - this is an operator view, not a personal one.
--
-- `capHit` is the operationally interesting number: referrals that QUALIFIED and
-- were then refused by the per-referrer cap. It is the only place the cap is
-- visible, and a silently rising figure is the early warning that the cap is now
-- costing the programme rather than protecting it.
--
-- Requires a capability check IN SQL, because a route can be bypassed and a
-- function cannot. `operator_has_capability` honours revoked_at.
create or replace function public.get_referral_programme_stats(p_actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
declare
  v_source app.reward_sources;
begin
  if not app_private.operator_has_capability(p_actor_id, 'referral.view') then
    raise exception 'get_referral_programme_stats: the actor does not hold referral.view'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_source from app.reward_sources s
  where s.source_type = 'AVERRA_PROMOTIONAL';

  return jsonb_build_object(
    'programmeOpen', app_private.system_config_bool('referral_programme_open', false),
    'thresholdMinor', app_private.system_config_bigint('qualification_threshold_minor', 0),
    'rewardMinor', app_private.system_config_bigint('referral_reward_minor', 0),
    'maxRewardsPerReferrer', app_private.system_config_bigint('maximum_rewards_per_referrer', 0),
    'unit', coalesce(v_source.currency_unit, 'NGN-kobo'),
    'funded', coalesce(v_source.is_active, false),
    'budgetTotalMinor', coalesce(v_source.budget_total_minor, 0),
    'budgetRemainingMinor', coalesce(v_source.budget_remaining_minor, 0),
    'codesIssued', (select count(*) from app.referral_codes),
    'attributed', (select count(*) from app.referrals),
    'qualified', (select count(*) from app.referrals where status in ('QUALIFIED','REWARDED')),
    'rewarded', (select count(*) from app.referrals where status = 'REWARDED'),
    -- QUALIFIED with no reward: work the worker has not yet completed, or could
    -- not. A non-zero value is the single most actionable number here.
    'unpaidQualified', (
      select count(*) from app.referrals r
      where r.status = 'QUALIFIED' and not exists (select 1 from app.rewards rw where rw.id = r.reward_id)
    ),
    -- QUALIFIED, unpaid, blocked by the cap. Distinct from the line above on
    -- purpose: this one is a policy decision, not a processing failure.
    'capHit', (
      select count(*) from app.referrals r
      where r.status = 'QUALIFIED'
        and not exists (select 1 from app.rewards rw where rw.id = r.reward_id)
        and app_private.system_config_bigint('maximum_rewards_per_referrer', 0) > 0
        and (
          select count(*) from app.referrals c
          where c.referrer_user_id = r.referrer_user_id and c.status = 'REWARDED'
        ) >= app_private.system_config_bigint('maximum_rewards_per_referrer', 0)
    ),
    'pendingPayoutEvents', (
      select count(*) from app.outbox_events
      where event_type = 'referral.payout_due' and status in ('PENDING','PROCESSING')
    ),
    'failedPayoutEvents', (
      select count(*) from app.outbox_events
      where event_type = 'referral.payout_due' and status = 'FAILED'
    )
  );
end;
$$;

revoke all on function public.get_referral_programme_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_referral_programme_stats(uuid) to service_role;

-- Funding is an operator action on real money, so it is surfaced here rather than
-- from a migration, and it is capability-gated. The AMOUNT is always an explicit
-- parameter; there is no default, so nobody can fund the programme by accident.
create or replace function public.admin_fund_referral_programme(
  p_actor_id uuid,
  p_budget_minor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_source app.reward_sources;
begin
  if not app_private.operator_has_capability(p_actor_id, 'referral.fund') then
    raise exception 'admin_fund_referral_programme: the actor does not hold referral.fund'
      using errcode = 'insufficient_privilege';
  end if;

  v_source := app_private.fund_promotional_reward_source(p_budget_minor, p_actor_id);

  return jsonb_build_object(
    'funded', v_source.is_active,
    'budgetTotalMinor', v_source.budget_total_minor,
    'budgetRemainingMinor', v_source.budget_remaining_minor,
    'unit', v_source.currency_unit
  );
end;
$$;

revoke all on function public.admin_fund_referral_programme(uuid, bigint) from public, anon, authenticated;
grant execute on function public.admin_fund_referral_programme(uuid, bigint) to service_role;