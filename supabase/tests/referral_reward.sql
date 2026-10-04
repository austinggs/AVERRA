-- =============================================================================
-- pgTAP: Referral reward funding, the per-referrer cap, and idempotency
--
-- Spec: the V1 referral programme, 71_ARCHITECTURAL_LAWS.md laws 8, 10, 27, 56.
--
-- The qualification engine is NOT tested here. CR-0025 owns it and its suite passes;
-- this file proves the PAYMENT layer, which had never executed once.
-- =============================================================================

begin;

-- 28 assertions, counted mechanically against this file (17 is, 8 ok, 3 throws_ok)
-- rather than estimated. Earlier drafts declared 16, 24 and 26.
select plan(29);

update app.system_config set value = '50000' where key = 'referral_reward_minor';
update app.system_config set value = '100' where key = 'maximum_rewards_per_referrer';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap-rr-ref@example.invalid', 'x',
   now(), now(), now(), '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap-rr-referee@example.invalid', 'x',
   now(), now(), now(), '{}'::jsonb);

select ok(
  app_private.get_or_create_account('11111111-1111-1111-1111-111111111111', 'EARNED_REWARD', 'NGN-kobo') is not null,
  'the referrer has an earned-reward account to receive the reward into'
);

-- A code, a referral, and a QUALIFIED referral without going through the
-- qualification engine - this file is about the payment layer, and building the
-- state through deposits would test CR-0025 twice.
select ok(
  (app_private.ensure_my_referral_code('11111111-1111-1111-1111-111111111111')).code is not null,
  'the referrer has a code'
);

create temporary table t_ref on commit drop as
  select (app_private.attribute_referral(
    p_referee_user_id => '22222222-2222-2222-2222-222222222222',
    p_code => (select c.code from app.referral_codes c
               where c.user_id = '11111111-1111-1111-1111-111111111111'))).id as id;

select ok(
  (app_private.qualify_referral((select id from t_ref), gen_random_uuid(), 500000::bigint, null)).id is not null,
  'the referral is QUALIFIED and ready to be paid'
);

-- -----------------------------------------------------------------------------
-- 1. An unfunded programme refuses to pay rather than creating an unbacked reward
-- -----------------------------------------------------------------------------
--
-- THIS SECTION USED TO ASSERT THE SHIPPED STATE.
--
-- It read "budget = 0" and "is_active = false" directly from the deployed source,
-- which was correct while the programme was unfunded by design (CR-0026) and became
-- wrong the moment the owner funded it (migration 056). Seven assertions here then
-- failed for one reason: not a defect in the payout path, but a test coupled to a
-- production data value.
--
-- The invariant worth keeping is not "the deployment is unfunded". It is
--
--     an unfunded programme REFUSES to pay, and creates no reward  (law 10)
--
-- which is a property of the payment path and must hold whatever the budget is. So
-- the precondition is established HERE, explicitly, inside this transaction. The
-- suite is now independent of the deployed funding decision - which is also what
-- stops it from having to be rewritten every time the owner funds or tops up.
--
-- The deployed budget itself is asserted in referral_payout_orchestration.sql, from
-- a baseline captured before that suite funds anything.

update app.reward_sources
set budget_total_minor = 0, budget_remaining_minor = 0, is_active = false
where source_type = 'AVERRA_PROMOTIONAL';

select is(
  (select s.budget_remaining_minor::int from app.reward_sources s
   where s.source_type = 'AVERRA_PROMOTIONAL'),
  0,
  'CONTROL-GATE: the programme is deliberately drained to a ZERO budget for this section'
);

select is(
  (select s.is_active from app.reward_sources s where s.source_type = 'AVERRA_PROMOTIONAL'),
  false,
  'and deactivated, so grant_reward refuses to pay'
);

select throws_ok(
  $$ select app_private.pay_referral_reward((select id from t_ref)) $$,
  '23503',
  'pay_referral_reward: the referral programme is not funded',
  'an unfunded programme refuses to pay rather than creating an unbacked reward'
);

select throws_ok(
  $$ select app_private.fund_promotional_reward_source(0, null) $$,
  '23514',
  'fund_promotional_reward_source: budget must be positive',
  'funding requires an explicit positive budget'
);

select is(
  (select count(*)::int from app.rewards r
   join app.referrals rf on rf.reward_id = r.id),
  0,
  'and still NO reward exists after a refused payout: law 10 holds'
);

-- AND THE REFERRER IS NOT SENT BACK TO ATTRIBUTED. A payout that cannot be funded is
-- a policy state, not a rejection: the referral genuinely qualified and stays
-- qualified, so it can be paid later without the qualification being recomputed.
select is(
  (select r.status::text from app.referrals r where r.id = (select id from t_ref)),
  'QUALIFIED',
  'a payout refused for lack of budget leaves the referral QUALIFIED, not REJECTED'
);

-- -----------------------------------------------------------------------------
-- 2. End-to-end payout, now that a budget exists
-- -----------------------------------------------------------------------------

select ok(
  (app_private.fund_promotional_reward_source(50000000::bigint, null)).id is not null,
  'the operator funds the programme explicitly and it activates'
);

select is(
  (select s.budget_remaining_minor::bigint from app.reward_sources s
   where s.source_type = 'AVERRA_PROMOTIONAL'),
  50000000::bigint,
  'the funded budget is recorded'
);

-- THE PAYOUT ITSELF. An earlier draft asserted the referral became REWARDED straight
-- after funding and never called the payout at all, so five assertions failed for the
-- single reason that nothing had paid anything yet.
select ok(
  (app_private.pay_referral_reward((select id from t_ref))).id is not null,
  'paying the QUALIFIED referral succeeds'
);

select is(
  (select r.status::text from app.referrals r where r.id = (select id from t_ref)),
  'REWARDED',
  'paying moves the referral to REWARDED'
);

select is(
  (select count(*)::int from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.id = (select id from t_ref)),
  1,
  'exactly one reward row exists'
);

-- The amount must come from CONFIGURATION, never from a caller. This is the whole
-- reason the wrapper resolves `referral_reward_minor` itself.
select is(
  (select rw.amount_minor from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.id = (select id from t_ref)),
  50000::bigint,
  'the reward is exactly the configured ₦500, not anything a caller supplied'
);

select is(
  (select rw.source_id::uuid from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.id = (select id from t_ref)),
  (select s.id from app.reward_sources s where s.source_type = 'AVERRA_PROMOTIONAL'),
  'LAW 56: the reward is drawn from AVERRA_PROMOTIONAL, never a provider budget or user money'
);

select is(
  (select s.budget_remaining_minor::bigint from app.reward_sources s
   where s.source_type = 'AVERRA_PROMOTIONAL'),
  (50000000::bigint - 50000::bigint),
  'and the promotional budget is decremented by exactly the reward'
);

-- -----------------------------------------------------------------------------
-- 3. Idempotency
-- -----------------------------------------------------------------------------

select ok(
  (app_private.pay_referral_reward((select id from t_ref))).id is not null,
  'paying an ALREADY-PAID referral succeeds rather than erroring'
);

select is(
  (select count(*)::int from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.id = (select id from t_ref)),
  1,
  'and it creates NO second reward'
);

select is(
  (select s.budget_remaining_minor::bigint from app.reward_sources s
   where s.source_type = 'AVERRA_PROMOTIONAL'),
  (50000000::bigint - 50000::bigint),
  'and it does not decrement the budget twice'
);

-- -----------------------------------------------------------------------------
-- 4. The per-referrer cap
-- -----------------------------------------------------------------------------

update app.system_config set value = '1' where key = 'maximum_rewards_per_referrer';

-- A SECOND REFEREE for the SAME referrer. `referral_codes_user_unique` means a user
-- has exactly one code, so a second code for the same referrer is impossible - the
-- cap is about a referrer having many REFERRALS, not many codes.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'pgtap-rr-referee2@example.invalid', 'x',
  now(), now(), now()
);

create temporary table t_ref2 on commit drop as
  select (app_private.attribute_referral(
    p_referee_user_id => '33333333-3333-3333-3333-333333333333',
    p_code => (select c.code from app.referral_codes c
               where c.user_id = '11111111-1111-1111-1111-111111111111'))).id as id;

select ok(
  (app_private.qualify_referral((select id from t_ref2), gen_random_uuid(), 500000::bigint, null)).id is not null,
  'a SECOND referral to the same referrer qualifies on its own merits'
);

select throws_ok(
  $$ select app_private.pay_referral_reward((select id from t_ref2)) $$,
  '23514',
  'pay_referral_reward: this referrer has reached the maximum of 1 rewards',
  'but the CAP refuses to pay it: a qualified referral can still earn nothing'
);

select is(
  (select r.status::text from app.referrals r where r.id = (select id from t_ref2)),
  'QUALIFIED',
  'and it stays QUALIFIED, not REJECTED: the cap is cost control, not a judgement on the user'
);

select is(
  (select count(*)::int from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.referrer_user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'and the cap refused BEFORE paying: still exactly one reward for the referrer'
);

-- RAISING THE CAP LETS IT PAY, which proves the refusal was the cap and not
-- something unrelated. The payout has to actually be ATTEMPTED again - an earlier
-- draft raised the cap and then only re-read the status, which stayed QUALIFIED
-- because nothing had asked for the money.
update app.system_config set value = '100' where key = 'maximum_rewards_per_referrer';

select ok(
  (app_private.pay_referral_reward((select id from t_ref2))).id is not null,
  'with the cap raised, the previously-refused referral pays'
);

select is(
  (select r.status::text from app.referrals r where r.id = (select id from t_ref2)),
  'REWARDED',
  'and it becomes REWARDED'
);

select is(
  (select count(*)::int from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.referrer_user_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'and the referrer now holds exactly two rewards'
);

-- -----------------------------------------------------------------------------
-- 5. Nothing about the reward is client-visible
-- -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.pay_referral_reward(uuid, text, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.pay_referral_reward(uuid, text, uuid)', 'EXECUTE'),
  'no browser role can execute the payout'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fund_promotional_reward_source', 'pay_referral_reward')
     and p.prosrc ~ '(p_amount|p_reward_amount)'),
  0,
  'no public function takes a reward AMOUNT parameter: the client cannot choose one'
);

select * from finish();

rollback;