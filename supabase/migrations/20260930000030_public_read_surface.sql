-- =============================================================================
-- Averra migration 030: Data API read surface for the non-exposed app schema
--
-- THE ARCHITECTURAL MISMATCH THIS FIXES
--
-- Migration 001 deliberately does NOT expose the `app` schema through the
-- Supabase Data API. That is the right decision: RLS on those tables is defence
-- in depth, not the primary control, and keeping them off PostgREST removes an
-- entire class of accidental exposure.
--
-- But `createAdminClient()` is a `@supabase/supabase-js` client, which talks
-- PostgREST, which only sees schemas listed in the project's exposed-schema
-- setting -- `public` by default. So `admin.from('notifications')` queries
-- `public.notifications`, which does not exist.
--
-- The result was that EVERY page-level read of an `app` table failed, and the
-- failure surfaced as an unhelpful log line rather than as a clear error.
--
-- THE FIX, AND WHY IT IS THIS SHAPE
--
-- This migration adds a deliberately small set of `public` SECURITY DEFINER
-- functions that are the ONLY way in. Each one:
--
--   * lives in `public`, so PostgREST can see it;
--   * is SECURITY DEFINER and scoped to one read;
--   * returns a bounded, purpose-shaped result rather than a whole table;
--   * takes the actor as a parameter and verifies it, so a caller cannot read
--     another user's data by passing their id.
--
-- It does NOT expose the tables, add `app` to the exposed schemas, or relax any
-- grant. The `app` schema stays invisible; only these named reads are reachable.
--
-- Adding `app` to the exposed schemas would be far simpler and is rejected: it
-- would make every table reachable through PostgREST and turn the deliberate
-- design decision into a configuration toggle that could be flipped by accident.
-- =============================================================================

-- Returns the caller's unread notification count.
--
-- The actor is a parameter because PostgREST passes RPC arguments as JSON. It is
-- verified against the caller's own JWT by the TypeScript layer, which passes
-- only the authenticated user id.
create or replace function public.get_unread_notification_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select count(*)::integer
  from app.notifications
  where user_id = p_user_id
    and read_at is null;
$$;

comment on function public.get_unread_notification_count(uuid) is
  'Doc 45. A named read through the non-exposed app schema. Returns a count only, never notification content.';

-- The wallet read model: both balances, kept separate.
--
-- Returns two JSON arrays rather than one merged figure, so a caller cannot
-- accidentally add them. Doc 09 and law 56: Earned Reward Balance and User
-- Funding Balance are different kinds of money.
create or replace function public.get_wallet_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  with user_accounts as (
    select a.id, a.domain, a.unit
    from app.ledger_accounts a
    where a.user_id = p_user_id
      and a.domain in ('EARNED_REWARD', 'USER_FUNDING')
  ),
  balances as (
    select u.id, u.domain, u.unit, coalesce(b.balance_minor, 0) as balance_minor
    from user_accounts u
    left join app.account_balances b on b.account_id = u.id
  ),
  -- Reserved is DERIVED from live reservation entries rather than read from a
  -- counter, so it cannot drift from the entries that created it. A reservation
  -- is a DEBIT whose source_type is WITHDRAWAL_RESERVATION and which has not
  -- been released.
  reserved as (
    select b.domain, b.unit, sum(e.amount_minor) as reserved_minor
    from balances b
    join app.ledger_entries e on e.account_id = b.id
    where e.source_type = 'WITHDRAWAL_RESERVATION'
      and e.direction = 'DEBIT'
      and not exists (
        select 1 from app.ledger_entries r
        where r.source_type = 'WITHDRAWAL_RELEASE'
          and r.source_id = e.source_id
      )
    group by b.domain, b.unit
  )
  select jsonb_build_object(
    'earnedRewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit', b.unit,
        'balanceMinor', b.balance_minor,
        'reservedMinor', coalesce(r.reserved_minor, 0),
        'availableMinor', b.balance_minor - coalesce(r.reserved_minor, 0)
      ) order by b.unit)
      from balances b left join reserved r on r.domain = b.domain and r.unit = b.unit
      where b.domain = 'EARNED_REWARD'
    ), '[]'::jsonb),
    'userFunding', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit', b.unit,
        'balanceMinor', b.balance_minor,
        'reservedMinor', coalesce(r.reserved_minor, 0),
        'availableMinor', b.balance_minor - coalesce(r.reserved_minor, 0)
      ) order by b.unit)
      from balances b left join reserved r on r.domain = b.domain and r.unit = b.unit
      where b.domain = 'USER_FUNDING'
    ), '[]'::jsonb)
  );
$$;

comment on function public.get_wallet_summary(uuid) is
  'Doc 09 / law 56. Returns the two balances as separate arrays so they cannot be merged by a caller.';

-- Live task catalogue with its verification mechanism.
--
-- The verification mechanism is included on purpose: doc 12 requires the user to
-- be able to see how a task is verified before attempting it.
create or replace function public.list_live_tasks()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'title', t.title,
    'description', t.description,
    'instructions', t.instructions,
    'state', t.state,
    'verificationMechanism', t.verification_mechanism,
    'rewardAmountMinor', t.reward_amount_minor,
    'rewardUnit', t.reward_unit,
    'minDurationSeconds', t.min_duration_seconds,
    'maxAttemptsPerUser', t.max_attempts_per_user,
    'availableFrom', t.available_from,
    'availableUntil', t.available_until
  )
  from app.task_definitions t
  where t.state = 'LIVE'
  order by t.created_at desc;
$$;

-- One task definition by id, in ANY state.
--
-- Deliberately NOT restricted to LIVE. The task detail page has to be able to
-- render a task that has been paused or retired, so the user can see why it can
-- no longer be attempted, rather than receiving a 404 and concluding the task
-- never existed. `list_live_tasks` remains the LIVE-only catalogue for
-- discovery; this is the detail read.
create or replace function public.get_task(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'title', t.title,
    'description', t.description,
    'instructions', t.instructions,
    'state', t.state,
    'verificationMechanism', t.verification_mechanism,
    'rewardAmountMinor', t.reward_amount_minor,
    'rewardUnit', t.reward_unit,
    'minDurationSeconds', t.min_duration_seconds,
    'maxAttemptsPerUser', t.max_attempts_per_user,
    'availableFrom', t.available_from,
    'availableUntil', t.available_until
  )
  from app.task_definitions t
  where t.id = p_task_id;
$$;

-- The caller's own task attempts, optionally narrowed to one task.
--
-- `p_task_id` exists because the task detail page shows one task's history. The
-- filter runs BEFORE the cap, so a user with many attempts across many tasks
-- still sees their attempts for the task actually being viewed.
create or replace function public.list_my_task_attempts(p_user_id uuid, p_task_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', a.id,
    'taskId', a.task_id,
    'status', a.status,
    'rewardId', a.reward_id,
    'rejectionReason', a.rejection_reason,
    'reviewReason', a.review_reason,
    'startedAt', a.started_at,
    'submittedAt', a.submitted_at,
    'verifiedAt', a.verified_at
  )
  from app.task_attempts a
  where a.user_id = p_user_id
    and (p_task_id is null or a.task_id = p_task_id)
  order by a.created_at desc
  limit 100;
$$;

-- Game state for the caller: player, machines and virtual inventory.
--
-- `isMoney: false` is included explicitly on inventory rows so no client can
-- render a game resource as a wallet balance (law 26).
create or replace function public.get_game_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'enrolled', exists (select 1 from app.game_players where user_id = p_user_id),
    'player', (
      select jsonb_build_object(
        'level', p.level, 'xp', p.xp,
        'energyCurrent', p.energy_current, 'energyMax', p.energy_max,
        'energyRegenPerMinute', p.energy_regen_per_minute,
        'energyLastCalculatedAt', p.energy_last_calculated_at,
        'stateVersion', p.state_version
      )
      from app.game_players p where p.user_id = p_user_id
    ),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'state', m.state, 'level', m.level,
        'condition', m.condition, 'locationSlot', m.location_slot,
        'lastProducedAt', m.last_produced_at, 'stateVersion', m.state_version,
        'type', jsonb_build_object(
          'code', t.code, 'name', t.name, 'energyCost', t.energy_cost,
          'productionIntervalSeconds', t.production_interval_seconds,
          'baseOutputMinor', t.base_output_minor
        )
      ) order by m.created_at)
      from app.game_machines m
      join app.game_machine_types t on t.id = m.machine_type_id
      where m.owner_user_id = p_user_id
    ), '[]'::jsonb),
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'resourceId', i.resource_id, 'quantity', i.quantity,
        'code', r.code, 'name', r.name, 'category', r.category,
        'isMoney', false
      ) order by r.name)
      from app.game_inventory i
      join app.game_resources r on r.id = i.resource_id
      where i.user_id = p_user_id
    ), '[]'::jsonb),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'code', mi.code, 'name', mi.name,
        'description', mi.description, 'objectives', mi.objectives,
        'rewardQuantity', mi.reward_quantity, 'rewardIsMoney', false
      ) order by mi.created_at)
      from app.game_missions mi where mi.is_active
    ), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.achievement_id, 'name', a.name,
        'badgeCode', a.badge_code, 'xpReward', a.xp_reward,
        'unlockedAt', u.unlocked_at
      ) order by u.unlocked_at desc)
      from app.game_achievement_unlocks u
      join app.game_achievements a on a.id = u.achievement_id
      where u.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

-- Referral overview for the caller.
--
-- Returns ONLY status and reason. No risk signal is joined, because the correct
-- way to keep a signal out of a user-facing read is to never query it (doc 39).
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
    'counts', jsonb_build_object(
      'total', count(*),
      'qualified', count(*) filter (where r.status = 'QUALIFIED'),
      'rewarded', count(*) filter (where r.status = 'REWARDED')
    ),
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r2.id, 'status', r2.status, 'reason', r2.status_reason,
        'qualifiedAt', r2.qualified_at, 'createdAt', r2.created_at
      ) order by r2.created_at desc)
      from (
        -- The list is capped so a user with a very large referral tree cannot
        -- make this one read unbounded. `counts` above is computed over ALL
        -- their referrals, not over this capped list.
        select id, status, status_reason, qualified_at, created_at
        from app.referrals
        where referrer_user_id = p_user_id
        order by created_at desc
        limit 50
      ) r2
    ), '[]'::jsonb)
  )
  -- The alias is REQUIRED. The FILTER clauses below reference `r.status`, and
  -- an unaliased table in this position leaves `r` unbound, which fails with
  -- "missing FROM-clause entry for table r".
  from app.referrals r
  where r.referrer_user_id = p_user_id;
$$;

-- Payout destinations for the caller, for the withdrawal form.
create or replace function public.list_my_payout_destinations(p_user_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', d.id, 'method', d.method, 'status', d.status,
    'accountHolder', d.account_holder,
    'label', coalesce(d.account_holder || ' · ', '') || d.account_identifier
  )
  from app.payout_destinations d
  where d.user_id = p_user_id
  order by d.created_at desc;
$$;

-- Grants.
--
-- Only these named reads are reachable. `anon` and `authenticated` are revoked
-- outright: every read here is scoped to the authenticated caller's own id,
-- which is verified in the TypeScript layer from the session JWT, so an
-- end-user session has no business invoking them.
revoke all on function public.get_unread_notification_count(uuid) from public, anon, authenticated;
revoke all on function public.get_wallet_summary(uuid) from public, anon, authenticated;
revoke all on function public.list_live_tasks() from public, anon, authenticated;
revoke all on function public.list_my_task_attempts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_task(uuid) from public, anon, authenticated;
revoke all on function public.get_game_state(uuid) from public, anon, authenticated;
revoke all on function public.get_referral_overview(uuid) from public, anon, authenticated;
revoke all on function public.list_my_payout_destinations(uuid) from public, anon, authenticated;

grant execute on function public.get_unread_notification_count(uuid) to service_role;
grant execute on function public.get_wallet_summary(uuid) to service_role;
grant execute on function public.list_live_tasks() to service_role;
grant execute on function public.list_my_task_attempts(uuid, uuid) to service_role;
grant execute on function public.get_task(uuid) to service_role;
grant execute on function public.get_game_state(uuid) to service_role;
grant execute on function public.get_referral_overview(uuid) to service_role;
grant execute on function public.list_my_payout_destinations(uuid) to service_role;