-- =============================================================================
-- pgTAP: growth system invariants
--
-- Spec: 39_REFERRAL_SYSTEM, 42_ADVERTISER_PLATFORM, 05_REWARD_ECONOMICS,
--       71_ARCHITECTURAL_LAWS.md law 10, law 16
--
-- The load-bearing assertions are the constraint checks: an account-creation
-- referral cannot become qualified, and an underfunded campaign cannot go live.
-- =============================================================================

begin;

select plan(17);

select has_table('app', 'referral_codes', 'referral codes exist');
select has_table('app', 'referrals', 'referrals exist');
select has_table('app', 'advertisers', 'advertisers exist');
select has_table('app', 'campaigns', 'campaigns exist');
select has_table('app', 'campaign_conversions', 'campaign conversions exist');

-- ---------------------------------------------------------------------------
-- FIXTURE. Four assertions below select from app.referral_codes, which is empty.
-- `... from app.referral_codes limit 1` therefore produced ZERO ROWS, the insert
-- inserted nothing, and `throws_ok` recorded "no exception": an assertion that
-- cannot fail proves nothing, and it hid a live schema defect (see test 13). The
-- code and the account it belongs to are created here once, and the tests below
-- select that code by value.
--
-- A real auth.users row is required because referral_codes.user_id REFERENCES
-- auth.users(id). Everything in this file is rolled back.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
  'authenticated', 'authenticated', 'pgtap-referrer@example.invalid',
  '', now(), now(), now()
);

insert into app.referral_codes (user_id, code)
select id, 'PGTAPREF01' from auth.users where email = 'pgtap-referrer@example.invalid';

-- ---------------------------------------------------------------------------
-- DOC 39 ANTI-ABUSE: self-referral is impossible, not merely detected.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.referrals (code_id, referrer_user_id, referee_user_id)
    select id, user_id, user_id from app.referral_codes where code = 'PGTAPREF01'
  $$,
  '23514',
  'new row for relation "referrals" violates check constraint "referrals_no_self_referral"',
  'a user cannot refer themselves'
);

-- A referee may only be referred once, so a referral cannot be duplicated.
select has_index('app', 'referrals', 'referrals_referee_unique', 'a referee may be referred once');

-- ---------------------------------------------------------------------------
-- DOC 39 QUALIFICATION, structurally enforced.
--
-- These prove an account-creation-only referral is unrepresentable: a row cannot
-- be written as QUALIFIED or REWARDED without naming the server-recorded event
-- that qualified it.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.referrals (code_id, referrer_user_id, referee_user_id, status)
    select id, user_id, gen_random_uuid(), 'QUALIFIED'
    from app.referral_codes where code = 'PGTAPREF01'
  $$,
  '23514',
  'new row for relation "referrals" violates check constraint "referrals_qualified_needs_event"',
  'a referral cannot be qualified without naming its qualifying event'
);

select throws_ok(
  $$
    insert into app.referrals (code_id, referrer_user_id, referee_user_id, status)
    select id, user_id, gen_random_uuid(), 'REWARDED'
    from app.referral_codes where code = 'PGTAPREF01'
  $$,
  '23514',
  'new row for relation "referrals" violates check constraint "referrals_qualified_needs_event"',
  'a referral cannot be rewarded without naming its qualifying event'
);

-- ---------------------------------------------------------------------------
-- LAW 10: a rewarded referral must trace to a reward AND a funding source.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.referrals (
      code_id, referrer_user_id, referee_user_id, status,
      qualifying_event_id, qualified_at, reward_source_id
    )
    select id, user_id, gen_random_uuid(), 'REWARDED',
           gen_random_uuid(), now(),
           (select id from app.reward_sources limit 1)
    from app.referral_codes where code = 'PGTAPREF01'
  $$,
  '23514',
  'new row for relation "referrals" violates check constraint "referrals_rewarded_needs_reward"',
  'a rewarded referral must name the reward it created'
);

-- The reward path goes through grant_reward.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('attribute_referral','qualify_referral','reward_referral')
      and p.prosrc ~ 'grant_reward'
  $$,
  $$ values (1::bigint) $$,
  'exactly one referral function calls grant_reward, and it is the reward path'
);

-- ---------------------------------------------------------------------------
-- DOC 42 FUNDING: budget reservation prevents overspend. An underfunded
-- campaign must be unrepresentable.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.campaigns (
      advertiser_id, name, state, budget_reserved_minor, max_exposure_minor
    )
    values (gen_random_uuid(), 'Underfunded', 'LIVE', 100, 100000)
  $$,
  '23514',
  'new row for relation "campaigns" violates check constraint "campaign_budget_reservation_covers_promise"',
  'a campaign cannot go live with a reservation below its maximum exposure'
);

-- Doc 42 BILLING: an unverified conversion is never billed.
--
-- This assertion found a REAL DEFECT and is why it is not weakened to suit the
-- database. Migration 025 shipped `verified = false or charged_amount_minor = 0`,
-- which permits billing an UNVERIFIED conversion and refuses a charge on a
-- VERIFIED one - the opposite of doc 42 BILLING and of its own comment. Migration
-- 037 corrects the polarity; this test is the regression proof.
select throws_ok(
  $$
    insert into app.campaign_conversions (campaign_id, verified, charged_amount_minor)
    values (gen_random_uuid(), false, 5000)
  $$,
  '23514',
  'new row for relation "campaign_conversions" violates check constraint "campaign_conversions_unverified_not_charged"',
  'an unverified conversion cannot be billed'
);

-- Money spent can never exceed money reserved.
select throws_ok(
  $$
    insert into app.campaigns (advertiser_id, name, budget_reserved_minor, budget_spent_minor)
    values (gen_random_uuid(), 'Overspent', 100, 500)
  $$,
  '23514',
  'new row for relation "campaigns" violates check constraint "campaigns_spent_within_reserved"',
  'a campaign cannot spend beyond its reservation'
);

-- RLS across the growth tables.
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in (
        'referral_codes','referrals','advertisers','campaigns','campaign_conversions'
      )
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every growth table'
);

-- No browser-facing role may attribute, qualify or reward a referral.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('attribute_referral','qualify_referral','reward_referral')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can attribute, qualify or reward a referral'
);

-- `name[]`, not `text`: see the note on the risk vocabulary assertion in
-- risk_moderation.sql. Casting an enum label to text carries collation C with it
-- and makes the comparison against a default-collation literal unresolvable.
select results_eq(
  $$
    select array_agg(e.enumlabel order by e.enumsortorder)
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'referral_status'
  $$,
  $$ values ('{ATTRIBUTED,QUALIFIED,REWARDED,REJECTED}'::name[]) $$,
  'the referral status vocabulary matches doc 39'
);

select * from finish();
rollback;