-- =============================================================================
-- Averra migration 048: Referral code entropy source correction
--
-- Correction to migration 047, found by running `supabase/tests/referrals.sql`.
--
-- 047 minted codes with `encode(gen_random_bytes(8), 'hex')`. `gen_random_bytes`
-- is a **pgcrypto** function, and `ensure_my_referral_code` runs with
-- `set search_path = app, pg_catalog` - which does not include the schema pgcrypto
-- is installed into on Supabase. The migration APPLIED SUCCESSFULLY, because a
-- plpgsql body is not validated at CREATE time, and then failed at the first call:
--
--     function gen_random_bytes(integer) does not exist
--
-- That is the same trap as migration 034's out-parameter defect, one level up: the
-- file is syntactically perfect and semantically broken, and no structural gate can
-- see it. Only executing it finds this.
--
-- THE FIX
--
-- `gen_random_uuid()` is core in PostgreSQL 13+ and is already the column default
-- throughout this schema, so it needs no extension and no search_path change.
-- Dashes are stripped and the first 10 hex characters uppercased, which satisfies
-- `referral_codes_code_shape` = `^[A-Z0-9]{6,16}$`.
--
-- A referral code is a public handle, not a credential: anyone holding one can read
-- it, and it authorises nothing on its own. Uniqueness and shape are what matter,
-- and both are asserted.
-- =============================================================================

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

  -- Retried on the astronomically unlikely collision. Catching a unique violation
  -- would abort the caller's transaction, and profile creation must never fail
  -- because a referral code collided.
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

  -- Five collisions in a row is not a collision problem, it is a broken entropy
  -- source, and saying so beats silently returning no code.
  raise exception 'ensure_my_referral_code: could not mint a unique code'
    using errcode = 'internal_error';
end;
$$;

revoke all on function app_private.ensure_my_referral_code(uuid) from public, anon, authenticated;
grant execute on function app_private.ensure_my_referral_code(uuid) to service_role;

-- The same correction in the backfill. Kept as its own statement so the two
-- functions cannot drift apart on the entropy source, which is exactly how 047
-- ended up needing a correction in the first place.
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