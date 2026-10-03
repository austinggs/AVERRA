-- -----------------------------------------------------------------------------
-- update_my_display_name
-- -----------------------------------------------------------------------------
-- The one profile field a user may change themselves. Everything else on
-- `app.profiles` - `account_status` above all - is written only by the provisioning
-- trigger or by an operator, and this function deliberately has no path to it.
--
-- Blanking the name is refused rather than allowed. A profile with no display name
-- renders as "Averra member" everywhere, which is a worse outcome than a name the
-- user chose badly, and an empty string is almost always an accident.
--
-- Idempotent: sending the name the profile already carries succeeds and changes
-- nothing, so a double submit is harmless.
create or replace function app_private.update_my_display_name(
  p_user_id uuid,
  p_display_name text
)
returns app.profiles
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_profile app.profiles;
  v_name text;
begin
  v_name := nullif(btrim(coalesce(p_display_name, '')), '');

  if v_name is null then
    raise exception 'update_my_display_name: a display name is required'
      using errcode = 'check_violation';
  end if;

  if length(v_name) > 60 then
    raise exception 'update_my_display_name: display name is too long'
      using errcode = 'check_violation';
  end if;

  -- Scoped by BOTH ids. A stranger's profile is reported as unknown rather than
  -- forbidden, which would otherwise confirm the id exists (doc 67 BOLA).
  select * into v_profile from app.profiles p
  where p.id = p_user_id for update;

  if not found then
    raise exception 'update_my_display_name: no profile for this account'
      using errcode = 'no_data_found';
  end if;

  update app.profiles set display_name = v_name where id = p_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function app_private.update_my_display_name(uuid, text) from public, anon, authenticated;
grant execute on function app_private.update_my_display_name(uuid, text) to service_role;

create or replace function public.update_my_display_name(
  p_user_id uuid,
  p_display_name text
)
returns app.profiles
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.update_my_display_name(p_user_id, p_display_name);
$$;

revoke all on function public.update_my_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public.update_my_display_name(uuid, text) to service_role;