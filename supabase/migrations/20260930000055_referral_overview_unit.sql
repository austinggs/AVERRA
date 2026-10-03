-- =============================================================================
-- Averra migration 055: supersede get_referral_overview to add the reward unit
--
-- WHY THIS FILE EXISTS
--
-- Migration 054 was APPLIED, and then `unit` was added to its body. That does not
-- reach the database: `supabase_migrations.schema_migrations` records 054 as
-- applied, so `db push` skips it forever. The deployed function had no `unit` key
-- while the file on disk claimed it did, so the referrals page rendered amounts with
-- a hardcoded fallback unit.
--
-- Editing an already-applied migration is the defect here, not the missing key. The
-- repository rule is that a migration is the authoritative record of what was
-- applied; once applied it is frozen. See docs/DISCREPANCIES.md Q-39.
--
-- So 054 is left byte-identical for a fresh install, and this file supersedes it
-- with `create or replace`. Both paths converge on the same final definition, which
-- is what makes the correction safe to apply in either order.
--
-- The body below is COMPLETE, not a patch. `create or replace` replaces the whole
-- body, so a partial one would silently delete every key not repeated here.
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
    'programmeOpen', app_private.system_config_bool('referral_programme_open', false),
    'rewardMinor', app_private.system_config_bigint('referral_reward_minor', 0),
    -- The unit every amount above is denominated in, taken from the reward source
    -- that will actually pay it. The UI must never label an amount with a unit
    -- other than the one it will be credited in.
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
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'referralId', r3.id,
        'rewardId', rw.id,
        'amountMinor', rw.amount_minor,
        'unit', rw.unit,
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

-- Re-stated rather than assumed. `create or replace` PRESERVES existing privileges,
-- so this revoke is belt-and-braces against a future edit that drops it - and it is
-- the revoke, not the grant, that is load-bearing (see AGENTS.md, Q-22).
revoke all on function public.get_referral_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_referral_overview(uuid) to service_role;