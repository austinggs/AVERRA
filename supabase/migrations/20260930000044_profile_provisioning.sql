-- =============================================================================
-- Averra migration 044: Guaranteed profile provisioning
--
-- Source of truth: 11_AUTH_IDENTITY_KYC.txt, doc 09, 71_ARCHITECTURAL_LAWS.md,
--                  80_PROGRESS_TEMPLATE.md
--
-- WHY THIS FILE EXISTS: EVERY USER SEES "ACCOUNT RESTRICTED"
--
-- The chain was:
--
--   1. signUpAction calls `ensure_my_profile` over the service role.
--   2. If that RPC FAILS, the error is only `console.error`'d and signup still
--      returns success. There is no retry and no backfill.
--   3. There was NO trigger on `auth.users`, so the profile row depended entirely
--      on that one app-layer call.
--   4. `getProfile` returns null when no row exists.
--   5. `isAccountActive(null)` evaluates `undefined === 'ACTIVE'` -> false.
--   6. The dashboard renders "Account restricted" and offers Contact support.
--
-- So an account whose profile creation failed was PERMANENTLY locked out with a
-- message that misdescribed the cause: a missing profile row is not a suspended
-- account.
--
-- TWO DEFECTS, AND FIXING EITHER ALONE WOULD MASK THE OTHER
--
--   A. Provisioning was not guaranteed. Fixed here: a trigger makes it structural,
--      so a bypassed or failed route cannot skip it. A comment was the only
--      previous enforcement, and a comment is not enforcement.
--   B. The UI conflated "no profile" with "restricted". Fixed in the application
--      layer (src/app/(app)/dashboard/page.tsx), not here.
--
-- THE BACKFILL IS SAFE BY CONSTRUCTION
--
-- `backfill_missing_profiles` inserts ONLY where no profile row exists. It never
-- updates an existing row, so it cannot alter `account_status` on an account that
-- was deliberately suspended or closed. An operator's decision is not undone by a
-- maintenance statement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- provision_user_profile: the single writer, called by the trigger and the backfill
-- -----------------------------------------------------------------------------
-- Idempotent on `id`. Display name comes from auth metadata when present, so a
-- signup that carries one lands with the name the user chose; otherwise the row is
-- created blank rather than not at all, because a blank profile is recoverable and
-- a missing one is a lockout.
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

  return v_profile;
end;
$$;

revoke all on function app_private.provision_user_profile(uuid, text) from public, anon, authenticated;
grant execute on function app_private.provision_user_profile(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- handle_auth_user_created: the trigger body
-- -----------------------------------------------------------------------------
create or replace function app_private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = search_path, public, pg_temp
as $$
begin
  perform app_private.provision_user_profile(
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')
  );

  return new;
end;
$$;

revoke all on function app_private.handle_auth_user_created() from public, anon, authenticated;

drop trigger if exists trg_auth_user_provision_profile on auth.users;

create trigger trg_auth_user_provision_profile
  after insert on auth.users
  for each row execute function app_private.handle_auth_user_created();

-- -----------------------------------------------------------------------------
-- backfill_missing_profiles: one time, for accounts that predate the trigger
-- -----------------------------------------------------------------------------
-- INSERTS ONLY. There is no update branch, deliberately: an account whose profile
-- exists has a status an operator may have set on purpose, and this function must
-- be incapable of touching it.
--
-- `where not exists` is the whole safety argument, so it is written as a plain
-- anti-join rather than an upsert that could match and overwrite.
create or replace function app_private.backfill_missing_profiles()
returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_count integer;
begin
  insert into app.profiles (id, display_name)
  select u.id, nullif(btrim(coalesce(u.raw_user_meta_data ->> 'display_name', '')), '')
  from auth.users u
  where not exists (select 1 from app.profiles p where p.id = u.id)
    -- Confirmed accounts only. An unconfirmed signup is not yet a user we want to
    -- write rows for; it will be provisioned when it confirms.
    and u.email_confirmed_at is not null;

  get diagnostics v_count = row_count;

  -- Surfaced through `supabase db push`. Without this the migration is silent and
  -- "how many accounts did this repair?" cannot be answered afterwards.
  raise notice 'PROVISIONING: backfilled % confirmed account(s) that had no profile row', v_count;

  return v_count;
end;
$$;

revoke all on function app_private.backfill_missing_profiles() from public, anon, authenticated;
grant execute on function app_private.backfill_missing_profiles() to service_role;

-- Run it once. Safe to re-run: the anti-join means a second call inserts nothing.
--
-- The count is raised as a NOTICE from INSIDE the function. "How many accounts did
-- this actually repair?" is the first question anyone will ask, and a bare `select`
-- in a migration transaction prints nothing.
--
-- It is deliberately NOT an anonymous `do $$ ... $$;` block. `npm run check:migrations`
-- pairs `$$` delimiters against `create function` declarations, so a DO block is
-- reported as an orphan `$$;` and fails the build. The gate is not wrong about the
-- file being unusual, and suppressing it would be the wrong fix.
select app_private.backfill_missing_profiles();

-- -----------------------------------------------------------------------------
-- ensure_my_profile now delegates, so there is ONE writer
-- -----------------------------------------------------------------------------
-- Migration 031 defined `public.ensure_my_profile` with its own copy of the insert.
-- Leaving two writers with the same job is how they drift, and a route that
-- reaches for the old one silently keeps the old behaviour. This replaces the body
-- with a delegate; the signature, the grant and every caller are unchanged.
create or replace function public.ensure_my_profile(p_user_id uuid, p_display_name text)
returns void
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.provision_user_profile(p_user_id, p_display_name);
$$;

revoke all on function public.ensure_my_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_my_profile(uuid, text) to service_role;