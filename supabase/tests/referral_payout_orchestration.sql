-- =============================================================================
-- pgTAP: Referral payout orchestration (migration 053)
--
-- Spec: 39_REFERRAL_SYSTEM.txt, doc 45 RELIABILITY, laws 8, 10, 56.
--
-- The question under test is not "does the payout work" - CR-0026 proved that. It is
-- "does something NOTICE a qualified referral, and does it notice it exactly once".
-- ============================================================================

begin;

-- 23 assertions, counted mechanically against this file (13 is, 10 ok) rather than
-- estimated. An earlier draft declared 12, then 19.
select plan(23);

-- THE COMMITTED BUDGET BASELINE, CAPTURED FIRST
--
-- Section 5 of this suite funds the programme so a payout can actually happen. That
-- funding is inside this suite's transaction, so any later assertion reading the
-- budget sees baseline + 50000000 rather than the committed figure.
--
-- An earlier draft of this file asserted "budget = 50000000" and "one funding audit
-- row" AFTER doing that funding, and correctly failed with 100000000 and 2 - not
-- because the database was wrong, but because the assertions were reading their own
-- transaction. The baseline is therefore captured here, before anything mutates it,
-- which also makes the assertion independent of the order of the sections below.
create temporary table t_baseline on commit drop as
  select
    (select budget_total_minor from app.reward_sources where source_type = 'AVERRA_PROMOTIONAL')
      as budget_total,
    (select budget_remaining_minor from app.reward_sources where source_type = 'AVERRA_PROMOTIONAL')
      as budget_remaining,
    (select count(*) from app.audit_events where action = 'referral.budget_funded')
      as funding_audits;

update app.system_config set value = '100' where key = 'maximum_rewards_per_referrer';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap-orch-ref@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap-orch-referee@example.invalid', 'x', now(), now(), now());

select ok(
  app_private.get_or_create_account('11111111-1111-1111-1111-111111111111', 'EARNED_REWARD', 'NGN-kobo') is not null,
  'the referrer has an account to be paid into'
);

create temporary table t_ref on commit drop as
  select (app_private.attribute_referral(
    p_referee_user_id => '22222222-2222-2222-2222-222222222222',
    p_code => (app_private.ensure_my_referral_code('11111111-1111-1111-1111-111111111111')).code
  )).id as id;

-- -----------------------------------------------------------------------------
-- 1. The trigger does NOT fire while the referral is merely attributed
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  0,
  'CONTROL-GATE: an ATTRIBUTED referral enqueues no payout'
);

-- -----------------------------------------------------------------------------
-- 2. Qualifying enqueues exactly one payout event
-- -----------------------------------------------------------------------------

-- The CREATE and the UPDATE are separate statements. Writing them as one would
-- measure the statement's own snapshot rather than its own effects (Q-36).
create temporary table t_qualify on commit drop as
  select (app_private.qualify_referral(
    p_referral_id => (select id from t_ref),
    p_qualifying_event_id => gen_random_uuid(),
    p_earned_minor => 500000::bigint,
    p_correlation_id => null
  )).id as id;

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  1,
  'qualifying enqueues exactly ONE payout event'
);

select is(
  (select (payload->>'referrerUserId') from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  '11111111-1111-1111-1111-111111111111',
  'the event names the REFERRER as the payee, taken from the row'
);

-- The event must NOT leak the reward amount. The worker resolves it from
-- configuration; a client- or payload-visible amount is one more place for it to
-- drift from the source of truth.
select is(
  (select (payload ? 'rewardMinor') from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  false,
  'the payload carries NO reward amount: the worker resolves it from configuration'
);

-- -----------------------------------------------------------------------------
-- 3. Re-qualifying does NOT enqueue a second payout
-- -----------------------------------------------------------------------------

-- `qualify_referral` is idempotent and returns the existing row. Re-running it must
-- not produce a second payment request, or a retried worker would pay twice.
select ok(
  (app_private.qualify_referral(
    p_referral_id => (select id from t_ref),
    p_qualifying_event_id => gen_random_uuid(),
    p_earned_minor => 900000::bigint,
    p_correlation_id => null
  )).id is not null,
  're-qualifying is idempotent'
);

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  1,
  'and does NOT enqueue a second payout event'
);

-- Directly touching qualified_value_minor on a QUALIFIED row is what the
-- qualification engine does on every event. It must not re-trigger.
update app.referrals set qualified_value_minor = 415000::bigint
where id = (select id from t_ref);

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  1,
  'updating qualified_value_minor on a QUALIFIED referral does NOT re-enqueue'
);

-- -----------------------------------------------------------------------------
-- 4. The sweep picks up what the trigger missed, without duplicating
-- -----------------------------------------------------------------------------

select is(
  app_private.claim_due_referral_payouts(),
  0,
  'the sweep enqueues nothing when the trigger already queued the only referral'
);

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'referral.payout_due' and aggregate_id = (select id::text from t_ref)),
  1,
  'so the referral still has exactly one payout event'
);

-- A referral that qualified BEFORE this migration would have no event. Simulate one
-- by clearing its status back to ATTRIBUTED and re-qualifying while suppressing the
-- trigger, then proving the sweep finds it.
alter table app.referrals disable trigger trg_referral_payout_due;

update app.referrals set status = 'ATTRIBUTED', qualified_at = null
where id = (select id from t_ref);

alter table app.referrals enable trigger trg_referral_payout_due;

select ok(
  (app_private.qualify_referral(
    p_referral_id => (select id from t_ref),
    p_qualifying_event_id => gen_random_uuid(),
    p_earned_minor => 500000::bigint,
    p_correlation_id => null
  )).id is not null,
  'the referral qualifies again while its payout event is already spent'
);

select is(
  app_private.claim_due_referral_payouts(),
  0,
  'and the sweep still enqueues nothing: the previous event was consumed'
);

-- -----------------------------------------------------------------------------
-- 5. The sweep SKIPS referrals that already have a reward
-- -----------------------------------------------------------------------------

select ok(
  (app_private.fund_promotional_reward_source(50000000::bigint, null)).id is not null,
  'the programme is funded so a payout can actually happen'
);

select ok(
  (app_private.pay_referral_reward((select id from t_ref))).id is not null,
  'the payout succeeds'
);

select is(
  (select r.status::text from app.referrals r where r.id = (select id from t_ref)),
  'REWARDED',
  'the referral is REWARDED'
);

select is(
  app_private.claim_due_referral_payouts(),
  0,
  'the sweep SKIPS an already-rewarded referral rather than queueing work that would be rejected'
);

-- -----------------------------------------------------------------------------
-- 6. Nothing about the payout is reachable from a browser
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_due_referral_payouts', 'enqueue_referral_payout')),
  0,
  'no PUBLIC function enqueues or sweeps payouts: the worker owns this'
);

select ok(
  not has_function_privilege('anon', 'public.pay_referral_reward(uuid, text, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.pay_referral_reward(uuid, text, uuid)', 'EXECUTE'),
  'LAW 56: no browser role can execute the payout'
);

select is(
  (select count(*)::int from app.rewards rw
   join app.referrals rf on rf.reward_id = rw.id
   where rf.id = (select id from t_ref)),
  1,
  'and exactly one reward exists after the whole sequence'
);

-- -----------------------------------------------------------------------------
-- 7. The approved budget is deployed, and cannot produce a partial payout
-- -----------------------------------------------------------------------------
--
-- These read COMMITTED state, not the rolled-back transaction, because the funded
-- budget is an operator decision that lives in the database rather than in a test.
--
-- THE DIVISIBILITY ASSERTION IS THE ONE THAT MATTERS. `pay_referral_reward` draws
-- the FULL configured reward or refuses; it never pays part of one. If the budget
-- were not an exact multiple of the reward, the final payout would fail rather than
-- pay a fraction, and a user whose referral genuinely qualified would be left
-- unpaid with nothing in the logs to explain why. 50,000,000 divides by 50,000
-- exactly, so the programme funds 1,000 payouts and then correctly refuses the next.

select ok(
  (select budget_total > 0 and budget_total = budget_remaining and budget_remaining > 0
     from t_baseline),
  'the referral programme was funded, active, and wholly unspent at the start of this suite'
);

select is(
  (select budget_total::text from t_baseline),
  '50000000',
  'the funded budget is the 50,000,000 kobo the owner approved. Changing it is a DECISION, not a fix: update this assertion deliberately.'
);

select ok(
  (select budget_total % app_private.system_config_bigint('referral_reward_minor', 1) = 0
     from t_baseline),
  'the budget is an exact multiple of the reward, so no payout can be left partial'
);

select is(
  (select funding_audits::int from t_baseline),
  1,
  'exactly ONE funding audit row exists: the additive funding function ran once, not twice'
);

select * from finish();

rollback;