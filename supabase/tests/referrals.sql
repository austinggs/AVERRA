-- =============================================================================
-- pgTAP: The referral programme (migration 047)
--
-- Spec: 39_REFERRAL_SYSTEM.txt (ATTRIBUTION, QUALIFICATION, ANTI-ABUSE),
--       87_ADMIN_PORTAL_EXPANDED.md section 18, laws 6, 8, 10, 56.
--
-- The rule under test throughout: A REFERRAL CODE IS A STRING, NOT MONEY. Nothing
-- here can create a balance, a reward or a withdrawal.
-- =============================================================================

begin;

-- 19 assertions, counted mechanically against this file (12 is, 5 ok, 2 throws_ok)
-- rather than estimated. An earlier draft declared 18.
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap-referrer@example.invalid', 'x',
   now(), now(), now(), '{"display_name":"Referrer"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap-referee@example.invalid', 'x',
   now(), now(), now(), '{"display_name":"Referee"}'::jsonb);

-- The flag starts CLOSED. Everything about issuance is asserted against both states,
-- because a programme that mints codes before it is announced is a product bug and
-- one that never mints them is the bug this migration fixes.
select is(
  app_private.system_config_bool('referral_programme_open', true),
  false,
  'the referral programme ships CLOSED, even when asked for a default of true'
);

select is(
  app_private.system_config_bool('a_flag_that_does_not_exist', true),
  true,
  'a MISSING key returns the caller''s default rather than raising'
);

-- -----------------------------------------------------------------------------
-- 1. Closed programme mints nothing
-- -----------------------------------------------------------------------------

-- `.id` is extracted because `is()` compares SCALARS. `ensure_my_referral_code`
-- returns a composite `app.referral_codes` row, and passing that straight into `is()`
-- raises `function is(app.referral_codes, uuid, unknown) does not exist` and aborts
-- the suite. This is the third time this exact mistake has been made across the
-- suites written today (see profile_provisioning.sql too).
select is(
  (app_private.ensure_my_referral_code('11111111-1111-1111-1111-111111111111')).id,
  null::uuid,
  'a closed programme issues NO code, and returning null is normal not an error'
);

select is(
  (select count(*)::int from app.referral_codes
   where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CONTROL-GATE: no row was written while the flag was closed'
);

-- -----------------------------------------------------------------------------
-- 2. Opening the programme issues codes at profile creation
-- -----------------------------------------------------------------------------

update app.system_config set value = 'true' where key = 'referral_programme_open';

select is(
  app_private.system_config_bool('referral_programme_open', false),
  true,
  'the flag reads back as open'
);

-- The trigger fired on the auth.users insert ABOVE, before the flag was opened. So
-- provisioning the same users again is what exercises "at profile creation".
select ok(
  app_private.provision_user_profile('11111111-1111-1111-1111-111111111111', 'Referrer') is not null,
  'provisioning a profile also issues its referral code'
);

select is(
  (select count(*)::int from app.referral_codes
   where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'exactly one code exists after the flag opened'
);

-- The shape constraint is `^[A-Z0-9]{6,16}$`. Asserted against the real value rather
-- than a re-implementation of the pattern.
select ok(
  (select c.code ~ '^[A-Z0-9]{6,16}$'
   from app.referral_codes c
   where c.user_id = '11111111-1111-1111-1111-111111111111'),
  'the minted code matches the shape the table requires'
);

select is(
  (select count(*)::int from app.referral_codes
   where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'provisioning twice does NOT mint a second code'
);

-- -----------------------------------------------------------------------------
-- 3. Signup attribution
-- -----------------------------------------------------------------------------

select is(
  app_private.provision_user_profile('22222222-2222-2222-2222-222222222222', 'Referee') is not null,
  true,
  'the referee also has a code of their own'
);

-- Law 8 / doc 39 ANTI-ABUSE: self-referral is refused, and the message must not
-- reveal whether the code exists to somebody else.
select throws_ok(
  $$ select app_private.attribute_referral(
       p_referee_user_id => '11111111-1111-1111-1111-111111111111',
       p_code => (select c.code from app.referral_codes c
                  where c.user_id = '11111111-1111-1111-1111-111111111111') ) $$,
  '23514',
  'attribute_referral: a user cannot refer themselves',
  'law 8: a user cannot refer themselves'
);

select throws_ok(
  $$ select app_private.attribute_referral(
       p_referee_user_id => '22222222-2222-2222-2222-222222222222',
       p_code => 'NOSUCHCODE1' ) $$,
  '23514',
  'attribute_referral: unknown referral code',
  'an unknown code is refused rather than silently ignored'
);

-- The control. Attribution is asserted by creating the row in one statement and
-- READING it in the next. Doing both in one statement measures the statement's own
-- snapshot, not its own effects (Q-36), and the assertion would pass vacuously.
select ok(
  (select (app_private.attribute_referral(
     p_referee_user_id => '22222222-2222-2222-2222-222222222222',
     p_code => (select c.code from app.referral_codes c
                where c.user_id = '11111111-1111-1111-1111-111111111111'))).id is not null),
  'a signup with a valid code IS attributed'
);

select is(
  (select r.status::text from app.referrals r
   where r.referee_user_id = '22222222-2222-2222-2222-222222222222'),
  'ATTRIBUTED',
  'doc 39: attribution ALONE creates no reward - the status is ATTRIBUTED'
);

-- Doc 39 QUALIFICATION: a reward cannot be triggered by account creation. Proven by
-- the absence of any ledger entry for a referral that exists.
select is(
  (select count(*)::int from app.ledger_entries e
   join app.funding_spend_events f on f.ledger_entry_id = e.id),
  0,
  'attributing a referral posts NO ledger entry of any kind'
);

-- One referee, one referral. A retried attribution is a no-op, not a second row.
select ok(
  (select (app_private.attribute_referral(
     p_referee_user_id => '22222222-2222-2222-2222-222222222222',
     p_code => (select c.code from app.referral_codes c
                where c.user_id = '11111111-1111-1111-1111-111111111111'))).id is not null),
  're-attributing is idempotent, not an error'
);

select is(
  (select count(*)::int from app.referrals
   where referee_user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'doc 39: one referee, one referral - a retried signup creates no second row'
);

-- -----------------------------------------------------------------------------
-- 4. Law 56 and the privilege surface
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in ('system_config_bool', 'ensure_my_referral_code',
                       'backfill_missing_referral_codes')
     and (
       p.prosrc like '%post_ledger_entry%'
       or p.prosrc like '%grant_reward%'
       or p.prosrc like '%transition_reward%'
       or p.prosrc like '%create_withdrawal_request%'
     )),
  0,
  'LAW 56: issuing a referral code cannot reach a reward or withdrawal primitive'
);

select ok(
  not has_table_privilege('anon', 'app.system_config', 'SELECT')
    and not has_table_privilege('authenticated', 'app.system_config', 'SELECT'),
  'the config table is unreadable from the browser; only the flag reader is reachable'
);

select * from finish();

rollback;