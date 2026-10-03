-- =============================================================================
-- Averra migration 045: Align the backfill with the provisioning trigger
--
-- Correction to migration 044, found by `supabase/tests/profile_provisioning.sql`
-- rather than by review.
--
-- THE INCONSISTENCY
--
-- 044's trigger `trg_auth_user_provision_profile` fires `after insert on auth.users`
-- and provisions EVERY signup, confirmed or not. A profile row for an unconfirmed
-- account is inert - Supabase blocks sign-in until the address is confirmed - so
-- provisioning early costs nothing and guarantees the row exists.
--
-- 044's `backfill_missing_profiles`, however, filtered on
-- `email_confirmed_at is not null`. That produced two defects:
--
--   1. An INCONSISTENCY: the trigger provisions unconfirmed accounts and the
--      backfill does not. The same question - "should this account have a profile?"
--      has two answers.
--
--   2. A PERMANENT GAP, which is the serious one. The trigger is INSERT-only. An
--      account that existed before the trigger, signed up while email confirmation
--      was pending, and confirmed afterwards, gets NO profile from either path: the
--      trigger never fires again, and the backfill skipped it. That account renders
--      "Account restricted" forever - exactly the defect 044 exists to fix.
--
-- The fix is to make the backfill match the trigger. A profile row for an
-- unconfirmed account is harmless and is exactly what that account would have been
-- given had the trigger existed at the time.
-- =============================================================================

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
  where not exists (select 1 from app.profiles p where p.id = u.id);

  get diagnostics v_count = row_count;

  raise notice 'PROVISIONING: backfilled % account(s) that had no profile row', v_count;

  return v_count;
end;
$$;

revoke all on function app_private.backfill_missing_profiles() from public, anon, authenticated;
grant execute on function app_private.backfill_missing_profiles() to service_role;

-- Repairs the accounts the filtered version skipped. Still insert-only, so a
-- deliberately SUSPENDED or CLOSED account is untouched.
select app_private.backfill_missing_profiles();

-- -----------------------------------------------------------------------------
-- Confirmation now also provisions, so the gap cannot reappear
-- -----------------------------------------------------------------------------
-- Belt and braces against the class of defect above. The INSERT trigger already
-- covers a new signup; this covers an account that exists with no profile for any
-- other reason and later becomes usable. Idempotent, because the writer is.
create or replace function app_private.handle_auth_user_confirmed()
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

revoke all on function app_private.handle_auth_user_confirmed() from public, anon, authenticated;

drop trigger if exists trg_auth_user_provision_on_confirm on auth.users;

create trigger trg_auth_user_provision_on_confirm
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function app_private.handle_auth_user_confirmed();