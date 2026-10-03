-- =============================================================================
-- pgTAP: Referral qualification engine (migration 050)
--
-- Spec: 39_REFERRAL_SYSTEM.txt, the V1 referral proposal, laws 6, 8, 10, 56.
--
--   eligible qualification amount
--     = confirmed deposits + eligible perk purchases - withdrawals
--
-- These assertions are almost entirely about the abuse rules, because that is where
-- a referral programme actually loses money.
-- =============================================================================

begin;

-- 28 assertions, counted mechanically against this file (23 is, 4 ok, 1 throws_ok)
-- rather than estimated. Earlier drafts declared 20 and 26.
select plan(28);

update app.system_config set value = 'true' where key = 'referral_programme_open';
update app.system_config set value = '500000' where key = 'qualification_threshold_minor';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap-ref@example.invalid', 'x',
   now(), now(), now(), '{"display_name":"Referrer"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap-referee@example.invalid', 'x',
   now(), now(), now(), '{"display_name":"Referee"}'::jsonb);

-- The referee needs a funding account for perk purchases to attach to, and the
-- referrer needs a referral code to be attributed through.
select ok(
  app_private.get_or_create_account('22222222-2222-2222-2222-222222222222', 'USER_FUNDING', 'NGN-kobo') is not null,
  'the referee has a funding account'
);

select is(
  (app_private.ensure_my_referral_code('11111111-1111-1111-1111-111111111111')).code is not null,
  true,
  'the referrer has a referral code'
);

-- THE REFERRAL ITSELF. Without this line every contribution is a no-op: the
-- recorder finds no referral for the referee and returns immediately. That is
-- correct behaviour - most users have no referral - but it means the fixture has to
-- create one, which is easy to forget and produces a suite where every assertion
-- reports NULL for the same uninteresting reason.
select ok(
  (app_private.attribute_referral(
    p_referee_user_id => '22222222-2222-2222-2222-222222222222',
    p_code => (select c.code from app.referral_codes c
               where c.user_id = '11111111-1111-1111-1111-111111111111')
  )).id is not null,
  'the referee is attributed to the referrer'
);

create temporary table t_referral on commit drop as
  select id from app.referrals where referee_user_id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from t_referral),
  1,
  'CONTROL: exactly one referral row exists to accumulate into'
);

-- -----------------------------------------------------------------------------
-- 1. The economics are configuration, not code
-- -----------------------------------------------------------------------------

select is(
  app_private.system_config_bigint('qualification_threshold_minor', 0),
  500000::bigint,
  'the ₦5,000 threshold is configuration (500000 kobo), readable as a bigint'
);

select is(
  app_private.system_config_bigint('referral_reward_minor', 0),
  50000::bigint,
  'the ₦500 reward is configuration (50000 kobo)'
);

-- A malformed threshold must NOT become a zero threshold. Zero would qualify every
-- referral the instant any transaction landed, which is the most expensive possible
-- misreading of a config typo.
update app.system_config set value = 'five hundred thousand' where key = 'qualification_threshold_minor';

select throws_ok(
  $$ select app_private.system_config_bigint('qualification_threshold_minor', 0) $$,
  '23514',
  'system_config_bigint: qualification_threshold_minor is not an integer',
  'a non-numeric threshold raises instead of silently becoming zero'
);

update app.system_config set value = '500000' where key = 'qualification_threshold_minor';

select is(
  app_private.system_config_bigint('a_threshold_that_does_not_exist', 0),
  0::bigint,
  'a missing threshold key defaults to 0, and 0 means never auto-qualify'
);

-- -----------------------------------------------------------------------------
-- 2. Deposits: verified only, and only on the CONFIRMED transition
-- -----------------------------------------------------------------------------

-- A deposit row with a DECLARED amount far above the VERIFIED one. Only the verified
-- figure may count, or the whole scheme is a self-asserted form.
--
-- Every NOT NULL column is supplied. `deposit_requests` requires
-- request_reference, destination_address and expires_at, and PostgreSQL enforces
-- NOT NULL before any CHECK, so a fixture missing one aborts the whole suite before
-- reaching the rule under test.
insert into app.deposit_requests (
  user_id, method, status, request_reference, chain_id,
  declared_asset, declared_token_contract, declared_amount_minor, declared_unit,
  destination_address, expires_at
) values (
  '22222222-2222-2222-2222-222222222222',
  'MANUAL_MINIPAY_CRYPTO',
  'SUBMITTED',
  'PGTAP-050-DEPOSIT-1',
  42220,
  'USDT',
  '0x0000000000000000000000000000000000000000',
  900000::bigint,
  'NGN-kobo',
  '0x000000000000000000000000000000000000dEaD',
  now() + interval '1 day'
);

select is(
  (select count(*)::int from app.referral_qualifying_events
   where source_type = 'DEPOSIT_CONFIRMED'),
  0,
  'CONTROL-GATE: a SUBMITTED deposit contributes NOTHING'
);

-- The qualifying move: SUBMITTED -> CONFIRMED with a verified amount. Only `status`
-- is watched by the trigger; `deposit_requests` has no `confirmed_at` column.
update app.deposit_requests
set status = 'CONFIRMED',
    verified_amount_minor = 500000::bigint,
    verified_at = now()
where declared_amount_minor = 900000::bigint;

select is(
  (select e.amount_minor from app.referral_qualifying_events e
   where e.source_type = 'DEPOSIT_CONFIRMED'),
  500000::bigint,
  'the VERIFIED amount contributes, not the larger DECLARED amount'
);

select is(
  (select r.status::text from app.referrals r where id = (select id from t_referral)),
  'QUALIFIED',
  'crossing ₦5,000 of verified deposit qualifies the referral automatically'
);

select is(
  (select r.qualified_value_minor from app.referrals r where id = (select id from t_referral)),
  500000::bigint,
  'the running net is recorded on the referral'
);

-- Doc 39: qualification is NOT a reward. It earns the RIGHT to one.
select is(
  (select count(*)::int from app.rewards r
   join app.referrals rf on rf.reward_id = r.id),
  0,
  'qualification creates NO reward: law 10 needs a funded source that does not exist yet'
);

-- -----------------------------------------------------------------------------
-- 3. Duplicate events cannot double count
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from app.referral_qualifying_events
   where source_type = 'DEPOSIT_CONFIRMED'),
  1,
  'exactly ONE contribution row exists for the deposit'
);

-- Re-fire the same transition by flipping away and back. The WHEN clause guards the
-- transition, and the unique constraint guards the row, so neither is relied on
-- alone.
update app.deposit_requests set status = 'SUBMITTED' where declared_amount_minor = 900000::bigint;
update app.deposit_requests set status = 'CONFIRMED' where declared_amount_minor = 900000::bigint;

select is(
  (select count(*)::int from app.referral_qualifying_events
   where source_type = 'DEPOSIT_CONFIRMED'),
  1,
  're-confirming the SAME deposit cannot contribute twice: unique (source_type, source_id)'
);

select is(
  (select r.qualified_value_minor from app.referrals r where id = (select id from t_referral)),
  500000::bigint,
  'and the running net is unchanged by the replay'
);

-- An update that does NOT change the status must not fire at all.
update app.deposit_requests
set verified_amount_minor = 777777::bigint
where declared_amount_minor = 900000::bigint;

select is(
  (select r.qualified_value_minor from app.referrals r where id = (select id from t_referral)),
  500000::bigint,
  'editing a confirmed deposit without changing status does NOT re-trigger'
);

-- -----------------------------------------------------------------------------
-- 4. Withdrawal deducts
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from app.payout_destinations
   where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'CONTROL: the referee has no payout destination yet, so the withdrawal fixture must create one'
);

insert into app.payout_destinations (user_id, method, account_identifier, account_holder, status)
select '22222222-2222-2222-2222-222222222222', 'BANK_MANUAL', '0000000000', 'Test Holder', 'VERIFIED'
where not exists (
  select 1 from app.payout_destinations d
  where d.user_id = '22222222-2222-2222-2222-222222222222'
);

insert into app.withdrawal_requests (user_id, method, destination_id, unit, gross_amount_minor, fee_amount_minor, net_amount_minor, status)
select '22222222-2222-2222-2222-222222222222', 'BANK_MANUAL',
       (select d.id from app.payout_destinations d
        where d.user_id = '22222222-2222-2222-2222-222222222222' limit 1),
       'NGN-kobo', 100000::bigint, 15000::bigint, 85000::bigint, 'REQUESTED';

select is(
  (select count(*)::int from app.referral_qualifying_events
   where source_type = 'WITHDRAWAL_DEDUCTION'),
  0,
  'CONTROL-GATE: a REQUESTED withdrawal deducts NOTHING'
);

update app.withdrawal_requests set status = 'COMPLETED'
where net_amount_minor = 85000::bigint;

select is(
  (select e.amount_minor from app.referral_qualifying_events e
   where e.source_type = 'WITHDRAWAL_DEDUCTION'),
  (-85000)::bigint,
  'a completed withdrawal deducts its NET amount (fee retained by Averra is not deducted)'
);

select is(
  (select r.qualified_value_minor from app.referrals r where id = (select id from t_referral)),
  415000::bigint,
  'the net drops from 500000 to 415000 after the withdrawal'
);

-- A referral already past the threshold stays QUALIFIED when a later withdrawal
-- pulls the total back below it. Doc 39 does not ask for a clawback, and silently
-- reversing a qualification that earned money would be a financial history rewrite.
select is(
  (select r.status::text from app.referrals r where id = (select id from t_referral)),
  'QUALIFIED',
  'a later withdrawal does NOT un-qualify a referral that already crossed the threshold'
);

-- -----------------------------------------------------------------------------
-- 5. Units are never converted, and the ledger is client-invisible
-- -----------------------------------------------------------------------------

-- An amount in a different unit must not count toward an NGN-kobo threshold.
-- Silently converting would mean inventing an exchange rate the system does not have.
--
-- Recorded through the writer directly rather than through a real purchase: a
-- `funding_spend_events` row with purpose PERK_PURCHASE must name a real
-- `paid_perk_orders` row (single_target plus a foreign key), and this fixture is
-- about the UNIT FILTER, not about a purchase. Exercising it at the writer is the
-- honest way to reach the branch without fabricating a paid order.
-- `.id` is extracted because `composite IS NOT NULL` is true only when EVERY field
-- is non-null, and `app.referrals` has nullable columns. This is the same mistake a
-- fourth time in this suite today.
select ok(
  (app_private.record_referral_qualifying_event(
    '22222222-2222-2222-2222-222222222222',
    'PERK_PURCHASE',
    gen_random_uuid(),
    999999999::bigint,
    'USD'
  )).id is not null,
  'a USD contribution is accepted by the writer and then rejected by the unit filter'
);

select is(
  (select count(*)::int from app.referral_qualifying_events
   where source_type = 'PERK_PURCHASE'),
  0,
  'a perk purchase in USD does NOT count toward an NGN-kobo threshold: no silent conversion'
);

select is(
  (select r.qualified_value_minor from app.referrals r where id = (select id from t_referral)),
  415000::bigint,
  'and the net is unchanged by the foreign-currency purchase'
);

select ok(
  not has_table_privilege('anon', 'app.referral_qualifying_events', 'SELECT')
    and not has_table_privilege('authenticated', 'app.referral_qualifying_events', 'SELECT'),
  'LAW 56: the contribution ledger is unreadable from the browser'
);

-- The client must not be able to drive qualification or learn the reward amount.
-- Both are enforced by there being no function that does either, which is asserted
-- against prosrc rather than trusted.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(record_referral_qualifying_event|qualify_referral|reward_referral)'),
  0,
  'no PUBLIC function can record qualification, qualify, or reward: the client cannot drive it'
);

select is(
  (select count(*)::int from app.rewards r
   join app.referrals rf on rf.reward_id = r.id),
  0,
  'LAW 10: no reward exists because reward_sources is empty and unfunded'
);

select * from finish();

rollback;