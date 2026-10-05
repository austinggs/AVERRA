-- =============================================================================
-- Averra migration 062: Put `extensions` on the participation search_path
--
-- Source of truth: 13_OFFERWALL_SYSTEM.txt TRACKING, doc 08 NORMALIZED EVENT
--
-- WHY THIS EXISTS RATHER THAN AN EDIT TO 060
--
-- Migration 060 is APPLIED. See AGENTS.md, "an applied migration is frozen": editing
-- it would change the file without changing the database, and `db push` would still
-- report success because `supabase_migrations.schema_migrations` records a version,
-- never a checksum. The correction goes forward.
--
-- THE DEFECT
--
-- `begin_provider_participation` minted its tracking id with
--
--     encode(gen_random_bytes(16), 'hex')
--
-- under `set search_path = app, pg_catalog`.
--
-- On Supabase, pgcrypto's functions are installed into a schema literally named
-- `extensions`. Not `public`. Not `pg_catalog`. So the name is not resolvable from
-- that search_path, and calling the function raises
--
--     function gen_random_bytes(integer) does not exist
--
-- THREE THINGS MADE THIS WORTH RECORDING
--
-- 1. It is raised at EXECUTION, not CREATE. The body is plpgsql, so PostgreSQL does
--    not validate it. Migration 060 applied cleanly, `check:migrations` passed, and
--    the function was dead on arrival. This is the "a language sql function cannot
--    reference a later-created table" rule one step further out - and plpgsql bodies
--    defer it further again, to first call.
--
-- 2. Every structural gate in this repository passed. The only thing that found it
--    was a pgTAP assertion that actually invoked the function. A lint cannot see a
--    missing schema in a search_path; only execution does.
--
-- 3. It was the very first thing the attribution suite exercised, so it surfaced
--    immediately rather than in production. Had the mint been added later, behind a
--    UI, this would have been a live 500 on click-through.
--
-- THE FIX
--
-- Add `extensions` to the search_path of `begin_provider_participation`. The scope is
-- deliberately minimal: this one function, not every SECURITY DEFINER function in the
-- database. Widening all of them on a guess would be a large unrequested change to
-- security-relevant code, and no other function here calls pgcrypto.
--
-- Note the ORDER. `app` and `pg_catalog` stay on the path; `extensions` is inserted
-- between them rather than prepended, so nothing can shadow an `app` function with a
-- pgcrypto one.
-- =============================================================================

create or replace function app_private.begin_provider_participation(
  p_user_id uuid,
  p_offer_id uuid,
  p_survey_id uuid
) returns text
language plpgsql
security definer
set search_path = app, extensions, pg_catalog
as $$
declare
  v_tracking_id text;
  v_provider_id uuid;
begin
  if p_user_id is null then
    raise exception 'begin_provider_participation: a user is required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The table's own `provider_participations_has_subject` check requires one of the
  -- two. Asserted here too so the error names the real problem instead of surfacing
  -- as a constraint violation from the insert.
  if p_offer_id is null and p_survey_id is null then
    raise exception 'begin_provider_participation: an offer or a survey is required'
      using errcode = 'check_violation';
  end if;

  if p_offer_id is not null then
    select provider_id into v_provider_id from app.offers where id = p_offer_id;
    if not found then
      raise exception 'begin_provider_participation: unknown offer %', p_offer_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if p_survey_id is not null then
    select provider_id into v_provider_id from app.surveys where id = p_survey_id;
    if not found then
      raise exception 'begin_provider_participation: unknown survey %', p_survey_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- 32 hex characters = 128 bits from a CSPRNG. Not a uuid: uuid v4 has 122 random
  -- bits but its textual form leaks a version nibble and is a recognisable shape,
  -- and a recognisable shape is a small help to someone enumerating. This is opaque
  -- and prefixed so it is greppable in a support ticket without being guessable.
  v_tracking_id := 'av_' || encode(gen_random_bytes(16), 'hex');

  insert into app.provider_participations (
    provider_id, user_id, tracking_id, offer_id, survey_id, status
  )
  values (
    v_provider_id, p_user_id, v_tracking_id, p_offer_id, p_survey_id, 'STARTED'
  );

  return v_tracking_id;
end;
$$;

revoke all on function app_private.begin_provider_participation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.begin_provider_participation(uuid, uuid, uuid)
  to service_role;

comment on function app_private.begin_provider_participation(uuid, uuid, uuid) is
  'Mints a 128-bit server-generated tracking id and opens a participation. The id is '
  'never client-supplied: unpredictability is the entire mitigation for a vendor that '
  'signs only its transaction id (doc 13 TRACKING). Migration 062: search_path includes '
  'extensions, where Supabase installs pgcrypto, so gen_random_bytes resolves.';