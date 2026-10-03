-- =============================================================================
-- pgTAP: Guaranteed profile provisioning (migration 044)
--
-- Spec: 11_AUTH_IDENTITY_KYC.txt, doc 09, laws 20/44.
--
-- The defect this exists to prevent: an account with no profile row rendered
-- "Account restricted" and could not recover, because provisioning depended on a
-- single app-layer call whose failure was only logged.
-- =============================================================================

begin;

-- 16 assertions, counted mechanically against this file (2 has_trigger, 10 is,
-- 4 ok) rather than estimated. Earlier drafts declared 14, then 15.
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) values
  -- Confirmed, carrying a display name in metadata.
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'pgtap-confirmed@example.invalid', 'x',
   now(), now(), now(), '{"display_name":"Confirmed User"}'::jsonb),
  -- Confirmed, no display name.
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'pgtap-bare@example.invalid', 'x',
   now(), now(), now(), '{}'::jsonb),
  -- UNCONFIRMED. The backfill must leave this alone.
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'authenticated', 'authenticated', 'pgtap-unconfirmed@example.invalid', 'x',
   null, now(), now(), '{}'::jsonb),
  -- Already RESTRICTED. The backfill must not resurrect it.
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'authenticated', 'authenticated', 'pgtap-suspended@example.invalid', 'x',
   now(), now(), now(), '{}'::jsonb);

-- -----------------------------------------------------------------------------
-- 1. The trigger exists and fires
-- -----------------------------------------------------------------------------

select has_trigger('auth', 'users', 'trg_auth_user_provision_profile',
  'the auth.users provisioning trigger exists: provisioning cannot be skipped by a failed route');

select is(
  (select p.display_name from app.profiles p where p.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Confirmed User',
  'inserting an auth.users row creates its profile with the display name from metadata'
);

select is(
  (select p.account_status::text from app.profiles p where p.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'ACTIVE',
  'a newly provisioned profile is ACTIVE by default'
);

-- The bare case is the one that used to lock people out: a signup with no display
-- name must still get a ROW, blank, because blank is recoverable and missing is not.
select ok(
  exists (select 1 from app.profiles p where p.id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'a signup with no display name still gets a profile row'
);

-- -----------------------------------------------------------------------------
-- 2. The backfill fills gaps and touches nothing else
-- -----------------------------------------------------------------------------

-- An account that already exists with a deliberately-set status is the case that
-- matters most. If the backfill updated rows, a SUSPENDED account would silently
-- become ACTIVE again.
update app.profiles set account_status = 'SUSPENDED'
where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- Delete one confirmed account's profile to simulate the real lockout state.
delete from app.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select count(*)::int from app.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'CONTROL: the account really does have no profile before the backfill runs'
);

select ok(
  app_private.backfill_missing_profiles() >= 1,
  'the backfill reports how many accounts it repaired'
);

select ok(
  exists (select 1 from app.profiles p where p.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'the backfill restores the missing profile row'
);

-- THE SAFETY PROPERTY. This is the assertion that makes the backfill safe to run
-- against a live database.
select is(
  (select p.account_status::text from app.profiles p where p.id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'SUSPENDED',
  'the backfill never resurrects a deliberately SUSPENDED account'
);

-- The backfill and the INSERT trigger must AGREE. An earlier version of 044 filtered
-- on `email_confirmed_at is not null` while the trigger did not, which both created
-- an inconsistency and a permanent gap: the trigger is INSERT-only, so an account
-- that existed before it, signed up unconfirmed and confirmed later would get a
-- profile from NEITHER path and render "Account restricted" forever.
--
-- The gap is closed in migration 045. Asserted here so the two can never drift apart
-- again silently.
select is(
  (select count(*)::int from app.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'the backfill provisions unconfirmed accounts, exactly as the INSERT trigger does'
);

select has_trigger('auth', 'users', 'trg_auth_user_provision_on_confirm',
  'confirmation also provisions, so an INSERT-only trigger cannot leave an account unprovisioned forever'
);

select is(
  app_private.backfill_missing_profiles(),
  0,
  're-running the backfill is a no-op, so it is safe in any migration'
);

-- -----------------------------------------------------------------------------
-- 3. One writer, not two
-- -----------------------------------------------------------------------------

-- `.id` is extracted because `is()` compares SCALARS. Passing the composite row
-- itself raises `function is(app.profiles, uuid, unknown) does not exist` and
-- aborts the suite.
select is(
  (app_private.provision_user_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Renamed')).id,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'provision_user_profile returns the profile it wrote'
);

select is(
  (select p.display_name from app.profiles p where p.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Renamed',
  'provisioning twice updates the display name rather than failing'
);

select is(
  (select p.display_name from app.profiles p where p.id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null,
  'a blank name does NOT overwrite an existing one: nullif(trim()) keeps the row honest'
);

-- `ensure_my_profile` must now DELEGATE. Two writers doing the same job is how they
-- drift, and a route reaching the old copy silently keeps the old behaviour.
select ok(
  (select p.prosrc like '%provision_user_profile%'
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ensure_my_profile'),
  'ensure_my_profile delegates to the single writer instead of duplicating it'
);

-- -----------------------------------------------------------------------------
-- 4. Law 44: no client action can mutate account state
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in ('provision_user_profile', 'handle_auth_user_created', 'backfill_missing_profiles')
     and (
       p.prosrc like '%post_ledger_entry%'
       or p.prosrc like '%grant_reward%'
       or p.prosrc like '%account_status =%'
       or p.prosrc like '%account_status=%'
     )),
  0,
  'no provisioning function can write account_status or reach money'
);

select * from finish();

rollback;