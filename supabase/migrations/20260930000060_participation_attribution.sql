-- =============================================================================
-- Averra migration 060: Server-minted, unpredictable participation attribution
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt ADAPTER INTERFACE, NORMALIZED
-- EVENT, 13_OFFERWALL_SYSTEM.txt, 14_SURVEY_SYSTEM.txt, doc 13 TRACKING,
-- 71_ARCHITECTURAL_LAWS.md laws 4/5/12/20
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- `public.resolve_tracking_user` (migration 034) resolves a provider's tracking id
-- to a user. It has worked perfectly since CR-0013 and it has NEVER resolved
-- anything, because no migration in this repository inserts into
-- `app.provider_participations`. The live CPX postback of 2026-10-04 carried an
-- empty `subid_1`, so every conversion landed as evidence with
-- `UNRESOLVED_TRACKING_ID`.
--
-- The absence was fail-closed and therefore safe. It is still the reason nothing is
-- payable end to end.
--
-- THE ATTACK THIS IS BUILT AGAINST
--
-- CPX signs ONLY the transaction id:
--
--     hash = md5(trans_id + secure_hash)
--
-- `subid_1` is NOT covered by the signature. The signature therefore authenticates
-- that SOMEONE sent us that transaction, and says nothing about WHOSE click it was.
-- Their transaction ids are visibly sequential (1001228169113), so they are
-- guessable. Once `subid_1` carries a live tracking id, anyone who can guess a
-- trans_id can post a well-formed callback naming any `subid_1` they like, and
-- `resolve_tracking_user` will faithfully credit that user.
--
-- Two things make that survivable rather than fatal, and NEITHER is a control:
--   * `provider_participations_tracking_unique` means one tracking id yields at most
--     one conversion, so a forgery cannot multiply a single victim's credit;
--   * a settlement report that does not contain the forged conversion surfaces it as
--     a VARIANCE (migration 059), and the reward never becomes AVAILABLE.
--
-- THE MITIGATION HERE IS UNPREDICTABILITY
--
-- The tracking id is 128 bits from `pgcrypto`'s CSPRNG, minted server-side. A
-- client may never choose one: a client-chosen id is a sequential id by another
-- name, and the whole property here is that it cannot be guessed. That is why this
-- is a COMMAND and not a column the caller writes.
--
-- This is defence in depth, not authentication. It raises the cost of a forgery; it
-- does not make one impossible, because the vendor signs only the transaction id.
-- The settlement gate (migration 059) is what actually prevents money leaving.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The mint.
-- -----------------------------------------------------------------------------
--
-- Returns the tracking id rather than the whole row. The caller needs the id to
-- build a link; it does not need the participation's internals, and returning less
-- is the habit that has kept every wrapper in this codebase narrow.
--
-- `search_path` INCLUDES `extensions`, and that is not cosmetic.
--
-- On Supabase, `gen_random_bytes`, `digest` and friends are installed into a schema
-- literally named `extensions` - NOT into `public` and NOT into `pg_catalog`. A
-- function with `set search_path = app, pg_catalog` therefore cannot see them, and
--
--     function gen_random_bytes(integer) does not exist
--
-- is raised at EXECUTION time, not at CREATE time, because the body is plpgsql. So
-- migration 060 applied cleanly, every structural gate passed, and the mint was dead
-- on arrival. This is the "a language sql function cannot reference a later-created
-- table" family of defect, one step further out: nothing validates the body, so only
-- running it finds this.
--
-- `pgcrypto` is on the search_path explicitly rather than relying on the caller's
-- session default, because the SECURITY DEFINER context does not inherit it.
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
  'signs only its transaction id (doc 13 TRACKING). Returns the tracking id only.';

-- -----------------------------------------------------------------------------
-- Marks a participation QUALIFIED.
-- -----------------------------------------------------------------------------
--
-- Qualification is NOT completion and NOT payment (doc 14). Kept separate so the
-- settlement gate has something to assert against later: a reward that exists for a
-- participation that never qualified is a defect worth surfacing, and it is only
-- visible if qualification is recorded.
create or replace function app_private.mark_participation_qualified(
  p_tracking_id text,
  p_provider_id uuid
) returns text
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_status text;
begin
  if p_tracking_id is null or length(trim(p_tracking_id)) = 0 then
    raise exception 'mark_participation_qualified: a tracking id is required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Scoped by BOTH provider and tracking id, so a tracking id from another provider
  -- reads as absent rather than being marked by the wrong one.
  --
  -- `app.provider_participations` has NO updated_at column and no such trigger, so
  -- there is nothing to stamp. Status changes are evidenced by
  -- `provider_callbacks` and the audit trail, not by mutating a timestamp that does
  -- not exist.
  update app.provider_participations
  set status = 'QUALIFIED'
  where provider_id = p_provider_id and tracking_id = trim(p_tracking_id)
  returning status into v_status;

  if not found then
    raise exception 'mark_participation_qualified: unknown tracking id'
      using errcode = 'check_violation';
  end if;

  -- Idempotent replay: the same participation may qualify twice, and that is the
  -- same outcome rather than an error.
  return v_status;
end;
$$;

revoke all on function app_private.mark_participation_qualified(text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.mark_participation_qualified(text, uuid)
  to service_role;

comment on function app_private.mark_participation_qualified(text, uuid) is
  'Marks a participation QUALIFIED. Qualification is not completion and not payment '
  '(doc 14). Scoped by provider AND tracking id, so a cross-provider id reads as absent.';


-- -----------------------------------------------------------------------------
-- THE ATTRIBUTION GATE.
-- -----------------------------------------------------------------------------
--
-- Refuses to resolve a tracking id that is not a live participation of THIS provider.
-- This is the function that makes a forged `subid_1` harmless.
--
-- WHY A NEW FUNCTION RATHER THAN A CHANGE TO `resolve_tracking_user`
--
-- `resolve_tracking_user` (migration 034) is applied, reviewed, and correct as
-- written: it scopes by provider_id AND tracking_id, which is already the property
-- that stops one user's callback crediting another account. It was not vulnerable
-- to being fed someone else's id - it was vulnerable to being fed ANY valid id,
-- because it has no notion of whether the participation is still live.
--
-- This function adds that notion without editing an applied function, and it is the
-- one the ingest path must use from now on. The old wrapper is left in place and
-- stays callable, because it is a pure read and removing it is not this migration's
-- business - but nothing new routes through it, and the attribution suite asserts
-- that the new path is the one in use.
create or replace function public.resolve_tracking_user_for_attribution(
  p_provider_id uuid,
  p_tracking_id text
) returns uuid
language sql
security definer
set search_path = app, pg_catalog
as $$
  -- A live participation, of THIS provider, matching EXACTLY.
  --
  -- STARTED and QUALIFIED both count: a conversion can legitimately arrive before
  -- qualification is recorded, and refusing that would drop real traffic on a race
  -- we control. INELIGIBLE, FAILED, COMPLETED and VERIFIED do NOT - once a
  -- participation is finished or failed, a late callback naming it is not evidence
  -- of anything.
  select p.user_id
  from app.provider_participations p
  where p.provider_id = p_provider_id
    and p.tracking_id = p_tracking_id
    and p.status in ('STARTED','QUALIFIED');
$$;

revoke all on function public.resolve_tracking_user_for_attribution(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_tracking_user_for_attribution(uuid, text)
  to service_role;

comment on function public.resolve_tracking_user_for_attribution(uuid, text) is
  'Resolves a tracking id to a user ONLY while its participation is STARTED or QUALIFIED. '
  'THE attribution path: a forged subid_1 naming someone else''s id still resolves, so '
  'this narrows the live window rather than pretending to authenticate the click. The '
  'settlement gate (migration 059) is what prevents money leaving.';