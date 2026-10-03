-- =============================================================================
-- Averra migration 047: Referral programme launch flag and code issuance
--
-- Source of truth: 39_REFERRAL_SYSTEM.txt (ATTRIBUTION, QUALIFICATION, ANTI-ABUSE),
--                  71_ARCHITECTURAL_LAWS.md laws 6, 8, 10 and 56,
--                  87_ADMIN_PORTAL_EXPANDED.md (18 System Configuration)
--
-- WHY THIS FILE EXISTS: THE REFERRAL FEATURE WAS INERT
--
-- Three separate things were missing, and the page was honest about all of them:
--
--  1. `app.referral_codes` was NEVER WRITTEN. No INSERT existed in any migration, so
--     `get_referral_overview` always returned `code: null` and the referrals page
--     rendered "Referral codes are issued when the referral programme opens." That is
--     the Q-38 shape for the third time in this repository.
--  2. `public.attribute_referral` EXISTED and was granted to service_role. The
--     plumbing was built and nothing ever called it, because the signup form had no
--     referral field.
--  3. `qualify_referral` and `reward_referral` existed and were never called.
--
-- DECIDED BEHAVIOUR: a code is issued AUTOMATICALLY at profile creation, behind a
-- launch flag, so every user has one the moment the programme opens.
--
-- WHY A FLAG RATHER THAN ALWAYS-ON
--
-- Doc 39 forbids rewarding "merely by account creation", and the product decision
-- that the programme is not announced until it is ready is a real one. A flag makes
-- that a configuration decision rather than a migration. It is also the seed of doc
-- 87's System Configuration module, so building it now avoids doing it twice.
--
-- LAW 56 - CODE IS NOT MONEY
--
-- A referral code is a string. Nothing in this file can create a balance, a reward
-- or a withdrawal, and no code is an entitlement. Asserted by absence in
-- `supabase/tests/referrals.sql`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- system_config: the foundation doc 87 section 18 will grow into
-- -----------------------------------------------------------------------------
create table app.system_config (
  key text primary key,
  value text not null,
  description text,
  -- Who last changed it. Null for values seeded by a migration.
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint system_config_key_shape check (key ~ '^[a-z0-9_]{2,80}$')
);

comment on table app.system_config is
  'Operator-editable configuration (doc 87 SYSTEM CONFIGURATION). Read through app_private helpers; never from the client.';

alter table app.system_config enable row level security;

revoke all on table app.system_config from public, anon, authenticated;

create index idx_system_config_key on app.system_config(key);

-- The switch. FALSE by default: a referral programme that has never been announced
-- must not silently start minting codes the moment this migration lands.
insert into app.system_config (key, value, description)
values (
  'referral_programme_open',
  'false',
  'When true, every account is issued a referral code at profile creation and new signups can attribute to a code.'
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- system_config_bool: one reader, so a flag is never parsed two different ways
-- -----------------------------------------------------------------------------
create or replace function app_private.system_config_bool(
  p_key text,
  p_default boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
declare
  v_value text;
begin
  select c.value into v_value from app.system_config c where c.key = p_key;

  -- A MISSING KEY IS NOT AN ERROR. It reads as the default, so adding a flag does
  -- not require every deployment to apply a migration first.
  if v_value is null then
    return p_default;
  end if;

  return lower(btrim(v_value)) in ('true', 't', 'yes', 'y', '1', 'on');
end;
$$;

revoke all on function app_private.system_config_bool(text, boolean) from public, anon, authenticated;
grant execute on function app_private.system_config_bool(text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- ensure_my_referral_code: mint the caller's code, once, if the programme is open
-- -----------------------------------------------------------------------------
-- Returns NULL when the flag is off, which is a NORMAL result and not an error: the
-- caller simply has no code yet. Nothing else in the system treats NULL as a fault.
--
-- Idempotent on `user_id`. `referral_codes_user_unique` guarantees one code per
-- person, so a retried provisioning cannot produce a second code and quietly orphan
-- the first from anybody who already shared it.
--
-- THE CODE IS NOT A SECRET AND NOT A CREDENTIAL. It is a public handle, readable by
-- anyone holding it. That is why it carries no entropy requirement beyond uniqueness
-- and why it is safe to put in a URL.
create or replace function app_private.ensure_my_referral_code(
  p_user_id uuid
)
returns app.referral_codes
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.referral_codes;
  v_attempt integer;
begin
  if not app_private.system_config_bool('referral_programme_open', false) then
    return null;
  end if;

  select * into v_existing from app.referral_codes c where c.user_id = p_user_id;

  if found then
    return v_existing;
  end if;

  -- Retried on the astronomically unlikely collision. The alternative - catching a
  -- unique violation - would abort the caller's transaction, and profile creation
  -- must not fail because a referral code collided.
  -- Entropy source: `gen_random_uuid()`. It is core in PostgreSQL 13+ and is already the
  -- column default across this schema, so it needs no extension and no
  -- `search_path` widening. `gen_random_bytes` was the first attempt and does NOT
  -- exist outside pgcrypto, which is not in this function's search_path.
  --
  -- A referral code is a public handle, not a credential, so 10 hex characters of a
  -- v4 UUID is ample uniqueness for the population this platform will ever have.
  -- What matters is that it is UNIQUE and matches `^[A-Z0-9]{6,16}$`, both of which
  -- are asserted.
  for v_attempt in 1 .. 5 loop
    begin
      insert into app.referral_codes (user_id, code)
      values (
        p_user_id,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      )
      returning * into v_existing;

      return v_existing;
    exception when unique_violation then
      continue;
    end;
  end loop;

  -- Five collisions in a row is not a collision problem, it is a broken random
  -- source, and saying so is better than returning no code.
  raise exception 'ensure_my_referral_code: could not mint a unique code'
    using errcode = 'internal_error';
end;
$$;

revoke all on function app_private.ensure_my_referral_code(uuid) from public, anon, authenticated;
grant execute on function app_private.ensure_my_referral_code(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- provision_user_profile now mints the code in the same call
-- -----------------------------------------------------------------------------
-- Redefined rather than extended elsewhere, because the decision was "a code is
-- issued AT PROFILE CREATION". Folding it into the single writer means profile and
-- code succeed or fail together, and there is no window in which a user has a
-- profile and no code.
--
-- This REPLACES the 044 body. The signature, the grants and every caller are
-- unchanged; only the body gains the issuance step.
create or replace function app_private.provision_user_profile(
  p_user_id uuid,
  p_display_name text default null
)
returns app.profiles
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_profile app.profiles;
begin
  insert into app.profiles (id, display_name)
  values (p_user_id, nullif(btrim(coalesce(p_display_name, '')), ''))
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, app.profiles.display_name),
        updated_at = now()
  returning * into v_profile;

  -- Result deliberately ignored: NULL simply means the programme is closed, which is
  -- not a provisioning failure.
  perform app_private.ensure_my_referral_code(p_user_id);

  return v_profile;
end;
$$;

revoke all on function app_private.provision_user_profile(uuid, text) from public, anon, authenticated;
grant execute on function app_private.provision_user_profile(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- backfill_missing_referral_codes: for accounts that predate the flag opening
-- -----------------------------------------------------------------------------
-- Opening the flag must reach everyone, not only people who happen to sign up
-- afterwards. Without this, flipping the switch would leave the entire existing user
-- base without codes and the referrals page would still say "programme not open" for
-- everyone who already has an account.
create or replace function app_private.backfill_missing_referral_codes()
returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_count integer;
begin
  if not app_private.system_config_bool('referral_programme_open', false) then
    raise notice 'REFERRALS: programme is closed, no codes minted';
    return 0;
  end if;

  insert into app.referral_codes (user_id, code)
  select p.id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  from app.profiles p
  where not exists (select 1 from app.referral_codes c where c.user_id = p.id)
  on conflict do nothing;

  get diagnostics v_count = row_count;

  raise notice 'REFERRALS: minted % referral code(s) for existing accounts', v_count;

  return v_count;
end;
$$;

revoke all on function app_private.backfill_missing_referral_codes() from public, anon, authenticated;
grant execute on function app_private.backfill_missing_referral_codes() to service_role;

select app_private.backfill_missing_referral_codes();

create or replace function public.backfill_missing_referral_codes()
returns integer
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.backfill_missing_referral_codes();
$$;

revoke all on function public.backfill_missing_referral_codes() from public, anon, authenticated;
grant execute on function public.backfill_missing_referral_codes() to service_role;