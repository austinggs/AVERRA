-- =============================================================================
-- Averra migration 039: Review commands and read surface
--
-- Source of truth: 86_REVIEWS_COMMUNITY_SYSTEM.md (REVIEW CREATION, THREAD /
--                  CHAT MODEL, MODERATION, API SURFACE, ACCEPTANCE CRITERIA),
--                  49_API_SPECIFICATION.txt (REVIEWS / COMMUNITY APIS),
--                  58_CONTENT_MODERATION.txt, 71_ARCHITECTURAL_LAWS.md laws 62-68
--
-- Three layers, and the reason each exists:
--
--   1. app_private commands  - the only writers. Every one validates ownership
--      and the state of the thing being written, because a route can be
--      bypassed and a function cannot.
--   2. public entry points   - thin, same-signature delegates so PostgREST can
--      resolve the RPC. The pattern (and the reason for it) is migration 035:
--      PostgREST only resolves against an exposed schema, and exposing
--      app_private would publish every internal money function at once.
--   3. public read wrappers  - the ONLY way public content is read. Each returns
--      a deliberate projection of PUBLISHED, undeleted rows and nothing else.
--
-- LAW 64 IS ENFORCED HERE, NOT IN THE UI
--
-- A "Verified Experience" badge is only granted when the referenced qualifying
-- event actually exists, in its own domain, and belongs to the author. The
-- client cannot assert it: it names an event id, and the database decides
-- whether that id is real and theirs. If it is not, the write is REFUSED rather
-- than silently downgraded to UNVERIFIED, because a review that silently loses
-- its badge is a lie the author did not write.
--
-- LAW 63 IS ENFORCED BY ABSENCE
--
-- No function in this file touches ledger_entries, rewards, deposits,
-- withdrawals, balances, or any financial table. Moderation changes content
-- status only. That is asserted by a pgTAP test in supabase/tests/reviews.sql,
-- which inspects these function bodies for money primitives.
-- =============================================================================

-- Was the claimed qualifying event real, and was it this user's?
--
-- Returns a boolean rather than raising, because the caller decides how to
-- report it. Deliberately does NOT reveal which of "does not exist" and "is not
-- yours" is true: both answer false, so a review cannot be used to probe whether
-- an arbitrary uuid exists elsewhere in the platform.
create or replace function app_private.review_experience_is_valid(
  p_user_id uuid,
  p_experience_type app.review_experience_type,
  p_experience_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
declare
  v_id uuid;
  v_found boolean := false;
begin
  if p_experience_id is null or btrim(p_experience_id) = '' then
    return false;
  end if;

  -- A malformed id is simply not a qualifying event. It must not raise an
  -- invalid_text_representation error, which would leak that the input was
  -- parsed as a uuid at all.
  begin
    v_id := p_experience_id::uuid;
  exception when others then
    return false;
  end;

  case p_experience_type
    when 'TASK_COMPLETION' then
      select exists (
        select 1 from app.task_attempts a
        where a.id = v_id and a.user_id = p_user_id and a.status = 'VERIFIED'
      ) into v_found;
    when 'WITHDRAWAL_COMPLETION' then
      select exists (
        select 1 from app.withdrawal_requests w
        where w.id = v_id and w.user_id = p_user_id and w.status = 'COMPLETED'
      ) into v_found;
    when 'DEPOSIT_CONFIRMATION' then
      select exists (
        select 1 from app.deposit_requests d
        where d.id = v_id and d.user_id = p_user_id and d.status = 'CONFIRMED'
      ) into v_found;
    when 'SUPPORT_INTERACTION' then
      select exists (
        select 1 from app.support_tickets t
        where t.id = v_id and t.user_id = p_user_id
      ) into v_found;
    else
      v_found := false;
  end case;

  return v_found;
end;
$$;

revoke all on function app_private.review_experience_is_valid(uuid, app.review_experience_type, text) from public, anon, authenticated;

-- Creates a review. It is created PENDING and is visible to nobody but its
-- author until a moderator publishes it (migration 038 header, law 67).
--
-- It writes NO reward, NO ledger entry and NO balance movement. A review is
-- content, and law 63 says content never mutates financial state. There is also
-- nothing to credit: law 65 forbids paying for a review at all.
create or replace function app_private.submit_review(
  p_user_id uuid,
  p_rating smallint,
  p_body text,
  p_title text default null,
  p_category text default null,
  p_verified_experience_type app.review_experience_type default null,
  p_verified_experience_id text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null
)
returns app.reviews
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.reviews;
  v_review app.reviews;
  v_verification app.review_verification_type := 'UNVERIFIED';
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'submit_review: rating must be between 1 and 5'
      using errcode = 'check_violation';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'submit_review: review body is required'
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'submit_review: an idempotency key is required'
      using errcode = 'not_null_violation';
  end if;

  -- A retried submission returns the row it already made instead of a duplicate
  -- (doc 86 acceptance 18: refresh or retry must not create duplicates).
  select * into v_existing from app.reviews r
  where r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'submit_review: idempotency key is already in use'
        using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  -- A claimed badge must be backed by a real qualifying event that belongs to
  -- the author. Supplying one without the other is a malformed request, not an
  -- unverifiable one, so it is rejected as such.
  if (p_verified_experience_type is null) <> (p_verified_experience_id is null) then
    raise exception
      'submit_review: a Verified Experience needs BOTH an experience type and an experience id'
      using errcode = 'check_violation';
  end if;

  if p_verified_experience_type is not null then
    if not app_private.review_experience_is_valid(
      p_user_id, p_verified_experience_type, p_verified_experience_id
    ) then
      raise exception
        'submit_review: the referenced qualifying event does not exist for this user, so it cannot be presented as a Verified Experience'
        using errcode = 'check_violation';
    end if;
    v_verification := 'VERIFIED_EXPERIENCE';
  end if;

  insert into app.reviews (
    user_id, rating, title, body, category,
    verification_type, verified_experience_type, verified_experience_id,
    idempotency_key
  ) values (
    p_user_id, p_rating, nullif(btrim(coalesce(p_title, '')), ''), p_body,
    nullif(btrim(coalesce(p_category, '')), ''),
    v_verification, p_verified_experience_type, p_verified_experience_id,
    p_idempotency_key
  )
  returning * into v_review;

  -- Doc 86 ADMINISTRATION + audit requirements. Content moderation is a
  -- distinct decision system (doc 58 SAFETY BOUNDARY), and this records the
  -- author's own action, not a moderation decision.
  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.submitted', 'review', v_review.id::text, 'SUCCESS',
    jsonb_build_object(
      'rating', v_review.rating,
      'status', v_review.status,
      'verificationType', v_review.verification_type
    )
  );

  return v_review;
end;
$$;

revoke all on function app_private.submit_review(uuid, smallint, text, text, text, app.review_experience_type, text, text, uuid) from public, anon, authenticated;

-- Adds a reply to a review thread (doc 86 THREAD / CHAT MODEL).
--
-- A reply is only accepted on a PUBLISHED review. You cannot hold a
-- conversation about something nobody can see, and allowing it would let a
-- hidden review accumulate content that would appear the moment it was restored.
create or replace function app_private.submit_review_comment(
  p_user_id uuid,
  p_review_id uuid,
  p_body text,
  p_parent_comment_id uuid default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null
)
returns app.review_comments
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_review app.reviews;
  v_existing app.review_comments;
  v_comment app.review_comments;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'submit_review_comment: comment body is required'
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'submit_review_comment: an idempotency key is required'
      using errcode = 'not_null_violation';
  end if;

  select * into v_existing from app.review_comments c
  where c.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'submit_review_comment: idempotency key is already in use'
        using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  select * into v_review from app.reviews r where r.id = p_review_id;

  if not found then
    raise exception 'submit_review_comment: unknown review'
      using errcode = 'no_data_found';
  end if;

  if v_review.deleted_at is not null or v_review.status <> 'PUBLISHED' then
    raise exception 'submit_review_comment: this review is not open for replies'
      using errcode = 'check_violation';
  end if;

  -- A reply must answer a comment on THIS review. The composite foreign key in
  -- migration 038 enforces the same thing; this check exists so the caller gets
  -- a sentence instead of a foreign-key violation, and so the intent is
  -- readable without consulting the schema.
  if p_parent_comment_id is not null then
    if not exists (
      select 1 from app.review_comments c
      where c.id = p_parent_comment_id and c.review_id = p_review_id
    ) then
      raise exception
        'submit_review_comment: the parent comment belongs to a different review'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into app.review_comments (review_id, parent_comment_id, user_id, body, idempotency_key)
  values (p_review_id, p_parent_comment_id, p_user_id, p_body, p_idempotency_key)
  returning * into v_comment;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.comment_added', 'review', p_review_id::text, 'SUCCESS',
    jsonb_build_object('commentId', v_comment.id, 'parentCommentId', p_parent_comment_id)
  );

  return v_comment;
end;
$$;

revoke all on function app_private.submit_review_comment(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- Records image METADATA for a review. The bytes are uploaded to Supabase
-- Storage by the server, which inspects them and derives `p_mime_type` from the
-- actual content (doc 86 IMAGE SUPPORT); this function stores what it was told
-- and the database rejects a type outside the allowlist.
--
-- The object begins PENDING and is therefore not publicly readable. Publication
-- of media is decided by the same moderation vocabulary as text.
create or replace function app_private.attach_review_media(
  p_uploader_id uuid,
  p_review_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null,
  p_metadata_stripped boolean default false,
  p_correlation_id uuid default null
)
returns app.review_media
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_review app.reviews;
  v_media app.review_media;
begin
  select * into v_review from app.reviews r where r.id = p_review_id;

  if not found then
    raise exception 'attach_review_media: unknown review'
      using errcode = 'no_data_found';
  end if;

  -- Only the author may attach to their own review, and only while it is still
  -- theirs to edit. This is the IDOR/BOLA boundary doc 67 tests for.
  if v_review.user_id <> p_uploader_id then
    raise exception 'attach_review_media: this review does not belong to the caller'
      using errcode = 'check_violation';
  end if;

  if v_review.deleted_at is not null then
    raise exception 'attach_review_media: this review has been deleted'
      using errcode = 'check_violation';
  end if;

  if p_mime_type not in ('image/jpeg','image/png','image/webp') then
    raise exception 'attach_review_media: unsupported image type %', p_mime_type
      using errcode = 'check_violation';
  end if;

  insert into app.review_media (
    review_id, uploader_id, storage_path, mime_type, byte_size, width, height, metadata_stripped
  ) values (
    p_review_id, p_uploader_id, p_storage_path, p_mime_type, p_byte_size,
    p_width, p_height, coalesce(p_metadata_stripped, false)
  )
  returning * into v_media;

  return v_media;
end;
$$;

revoke all on function app_private.attach_review_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) from public, anon, authenticated;

-- Records a user report against a review, a comment or an image.
--
-- The target is validated to EXIST, because a report against a nonexistent
-- object is either a bug or a probe, and neither belongs in a moderator queue.
-- Repeat reports from the same user are idempotent rather than rejected: a
-- double tap should not look like an error to the user.
create or replace function app_private.report_review_content(
  p_reporter_id uuid,
  p_target_type app.review_content_target,
  p_target_id uuid,
  p_reason_code text,
  p_details text default null,
  p_correlation_id uuid default null
)
returns app.review_reports
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_existing app.review_reports;
  v_report app.review_reports;
  v_exists boolean := false;
begin
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'report_review_content: a reason code is required'
      using errcode = 'check_violation';
  end if;

  case p_target_type
    when 'REVIEW' then
      select exists (select 1 from app.reviews x where x.id = p_target_id) into v_exists;
    when 'REVIEW_COMMENT' then
      select exists (select 1 from app.review_comments x where x.id = p_target_id) into v_exists;
    when 'REVIEW_MEDIA' then
      select exists (select 1 from app.review_media x where x.id = p_target_id) into v_exists;
    when 'REVIEW_COMMENT_MEDIA' then
      select exists (select 1 from app.review_comment_media x where x.id = p_target_id) into v_exists;
    else
      v_exists := false;
  end case;

  if not v_exists then
    raise exception 'report_review_content: unknown % target', p_target_type
      using errcode = 'no_data_found';
  end if;

  select * into v_existing from app.review_reports r
  where r.reporter_id = p_reporter_id
    and r.target_type = p_target_type
    and r.target_id = p_target_id;

  if found then
    return v_existing;
  end if;

  insert into app.review_reports (reporter_id, target_type, target_id, reason_code, details)
  values (p_reporter_id, p_target_type, p_target_id, p_reason_code, p_details)
  returning * into v_report;

  return v_report;
end;
$$;

revoke all on function app_private.report_review_content(uuid, app.review_content_target, uuid, text, text, uuid) from public, anon, authenticated;

-- Capability check that takes an explicit operator id.
--
-- WHY NOT app.has_capability(): that reads auth.uid(), which is NULL on the
-- service-role connection every route uses, so it returns false for everyone and
-- silently denies all moderation while appearing secure (see
-- src/lib/auth/capabilities.ts and migration 012). The operator id here came
-- from a verified session, never from a request body.
--
-- WHY revoked_at IS FILTERED: app.has_capability() does NOT filter it, so a
-- REVOKED operator still passes that check. Revocation that does not revoke is
-- the worst kind of security bug, so this guard honours it. The divergence is
-- recorded in docs/DISCREPANCIES.md.
create or replace function app_private.operator_has_capability(
  p_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select exists (
    select 1
    from app.admin_users au
    join app.admin_role_capabilities rc on rc.role_code = au.role_code
    where au.user_id = p_user_id
      and au.revoked_at is null
      and rc.capability_code = p_capability
  );
$$;

revoke all on function app_private.operator_has_capability(uuid, text) from public, anon, authenticated;

-- Applies a moderator's decision to public content.
--
-- Law 67: the decision is human. This function does not choose an action; it
-- records and applies one an authorised person made. It changes CONTENT STATUS
-- ONLY. There is no path from here to a balance, a reward, a deposit, a
-- withdrawal or a fraud decision, which is what law 63 and doc 71 V7 Admin law 6
-- require ("Review moderation never alters financial history").
--
-- The action vocabulary is checked against the target kind, and a mismatch is
-- REFUSED rather than coerced: media has no HIDDEN state, so asking to hide an
-- image is a caller bug, and quietly converting it to REMOVED would make the
-- moderator's record say something they did not choose.
create or replace function app_private.moderate_review_content(
  p_moderator_id uuid,
  p_target_type app.review_content_target,
  p_target_id uuid,
  p_action app.review_moderation_action,
  p_reason_code text,
  p_evidence_reference text default null,
  p_correlation_id uuid default null
)
returns app.review_moderation_actions
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_action app.review_moderation_actions;
  v_content_status app.review_status;
  v_media_status app.review_media_status;
  v_exists boolean := false;
begin
  if not app_private.operator_has_capability(p_moderator_id, 'review.moderate') then
    raise exception 'moderate_review_content: the actor does not hold review.moderate'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'moderate_review_content: a reason code is required'
      using errcode = 'check_violation';
  end if;

  -- Text targets share app.review_status.
  if p_target_type in ('REVIEW','REVIEW_COMMENT') then
    v_content_status := case p_action
      when 'APPROVE' then 'PUBLISHED'
      when 'RESTORE' then 'PUBLISHED'
      when 'HIDE'    then 'HIDDEN'
      when 'REMOVE'  then 'REMOVED'
      when 'REJECT'  then 'REMOVED'
      else null
    end;

    if v_content_status is null then
      raise exception 'moderate_review_content: % is not a valid action for %',
        p_action, p_target_type using errcode = 'check_violation';
    end if;

    if p_target_type = 'REVIEW' then
      update app.reviews
         set status = v_content_status,
             published_at = case
               when v_content_status = 'PUBLISHED' then coalesce(published_at, now())
               else published_at
             end
       where id = p_target_id;
      v_exists := found;
    else
      update app.review_comments set status = v_content_status where id = p_target_id;
      v_exists := found;
    end if;

  -- Media targets share app.review_media_status, which has no HIDDEN value.
  elsif p_target_type in ('REVIEW_MEDIA','REVIEW_COMMENT_MEDIA') then
    v_media_status := case p_action
      when 'APPROVE' then 'APPROVED'
      when 'RESTORE' then 'APPROVED'
      when 'REJECT'  then 'REJECTED'
      when 'REMOVE'  then 'REMOVED'
      else null
    end;

    if v_media_status is null then
      raise exception 'moderate_review_content: % is not a valid action for % (media has no hidden state)',
        p_action, p_target_type using errcode = 'check_violation';
    end if;

    if p_target_type = 'REVIEW_MEDIA' then
      update app.review_media set status = v_media_status where id = p_target_id;
      v_exists := found;
    else
      update app.review_comment_media set status = v_media_status where id = p_target_id;
      v_exists := found;
    end if;
  else
    raise exception 'moderate_review_content: unsupported target type %', p_target_type
      using errcode = 'check_violation';
  end if;

  if not v_exists then
    raise exception 'moderate_review_content: unknown % target', p_target_type
      using errcode = 'no_data_found';
  end if;

  -- Append-only. A correction is a new action (RESTORE after HIDE), never an
  -- edit of this row; the trigger in migration 038 enforces that.
  insert into app.review_moderation_actions (
    target_type, target_id, action, reason_code, moderator_id, evidence_reference
  ) values (
    p_target_type, p_target_id, p_action, p_reason_code, p_moderator_id, p_evidence_reference
  )
  returning * into v_action;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_moderator_id, 'review.moderated', 'review', p_target_id::text, 'SUCCESS',
    jsonb_build_object(
      'targetType', p_target_type, 'action', p_action,
      'reasonCode', p_reason_code, 'moderationActionId', v_action.id
    )
  );

  return v_action;
end;
$$;

revoke all on function app_private.moderate_review_content(uuid, app.review_content_target, uuid, app.review_moderation_action, text, text, uuid) from public, anon, authenticated;

-- Resolves a report. Separate from moderating content on purpose: deciding that
-- a report is unfounded (DISMISSED) is not the same judgement as deciding that
-- the content is fine, and doc 86 gives reports their own status and resolver
-- columns so the two cannot be conflated. A moderator may dismiss a report and
-- still HIDE the content, or resolve a report as actionable and leave the
-- content published pending edit.
create or replace function app_private.resolve_review_report(
  p_moderator_id uuid,
  p_report_id uuid,
  p_status app.review_report_status,
  p_reason_code text,
  p_correlation_id uuid default null
)
returns app.review_reports
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_report app.review_reports;
begin
  if not app_private.operator_has_capability(p_moderator_id, 'review.moderate') then
    raise exception 'resolve_review_report: the actor does not hold review.moderate'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'resolve_review_report: a reason code is required'
      using errcode = 'check_violation';
  end if;

  update app.review_reports
     set status = p_status,
         resolved_by = case when p_status in ('RESOLVED','DISMISSED') then p_moderator_id else null end,
         resolved_at = case when p_status in ('RESOLVED','DISMISSED') then now() else null end
   where id = p_report_id
  returning * into v_report;

  if not found then
    raise exception 'resolve_review_report: unknown report'
      using errcode = 'no_data_found';
  end if;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_moderator_id, 'review.report_resolved', 'review_report', v_report.id::text, 'SUCCESS',
    jsonb_build_object('status', v_report.status, 'reasonCode', p_reason_code)
  );

  return v_report;
end;
$$;

revoke all on function app_private.resolve_review_report(uuid, uuid, app.review_report_status, text, uuid) from public, anon, authenticated;

-- =============================================================================
-- Public entry points.
--
-- Same-signature delegates so PostgREST can resolve the RPC, exactly as in
-- migration 035. They add no logic and make no decision; the app_private command
-- remains the authority. Every one of them must revoke `public, anon,
-- authenticated` BEFORE granting, or `npm run check:grants` fails the build -
-- the migration-036 lesson (Q-22), where 29 wrappers were born executable by an
-- unauthenticated caller.
-- =============================================================================

create or replace function public.submit_review(
  p_user_id uuid,
  p_rating smallint,
  p_body text,
  p_title text default null,
  p_category text default null,
  p_verified_experience_type app.review_experience_type default null,
  p_verified_experience_id text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null
)
returns app.reviews
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.submit_review(
    p_user_id, p_rating, p_body, p_title, p_category,
    p_verified_experience_type, p_verified_experience_id,
    p_idempotency_key, p_correlation_id
  );
$$;

revoke all on function public.submit_review(uuid, smallint, text, text, text, app.review_experience_type, text, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_review(uuid, smallint, text, text, text, app.review_experience_type, text, text, uuid) to service_role;

create or replace function public.submit_review_comment(
  p_user_id uuid,
  p_review_id uuid,
  p_body text,
  p_parent_comment_id uuid default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null
)
returns app.review_comments
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.submit_review_comment(
    p_user_id, p_review_id, p_body, p_parent_comment_id, p_idempotency_key, p_correlation_id
  );
$$;

revoke all on function public.submit_review_comment(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_review_comment(uuid, uuid, text, uuid, text, uuid) to service_role;

create or replace function public.attach_review_media(
  p_uploader_id uuid,
  p_review_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null,
  p_metadata_stripped boolean default false,
  p_correlation_id uuid default null
)
returns app.review_media
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.attach_review_media(
    p_uploader_id, p_review_id, p_storage_path, p_mime_type, p_byte_size,
    p_width, p_height, p_metadata_stripped, p_correlation_id
  );
$$;

revoke all on function public.attach_review_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.attach_review_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) to service_role;

create or replace function public.report_review_content(
  p_reporter_id uuid,
  p_target_type app.review_content_target,
  p_target_id uuid,
  p_reason_code text,
  p_details text default null,
  p_correlation_id uuid default null
)
returns app.review_reports
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.report_review_content(
    p_reporter_id, p_target_type, p_target_id, p_reason_code, p_details, p_correlation_id
  );
$$;

revoke all on function public.report_review_content(uuid, app.review_content_target, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.report_review_content(uuid, app.review_content_target, uuid, text, text, uuid) to service_role;

create or replace function public.moderate_review_content(
  p_moderator_id uuid,
  p_target_type app.review_content_target,
  p_target_id uuid,
  p_action app.review_moderation_action,
  p_reason_code text,
  p_evidence_reference text default null,
  p_correlation_id uuid default null
)
returns app.review_moderation_actions
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.moderate_review_content(
    p_moderator_id, p_target_type, p_target_id, p_action, p_reason_code,
    p_evidence_reference, p_correlation_id
  );
$$;

revoke all on function public.moderate_review_content(uuid, app.review_content_target, uuid, app.review_moderation_action, text, text, uuid) from public, anon, authenticated;
grant execute on function public.moderate_review_content(uuid, app.review_content_target, uuid, app.review_moderation_action, text, text, uuid) to service_role;

create or replace function public.resolve_review_report(
  p_moderator_id uuid,
  p_report_id uuid,
  p_status app.review_report_status,
  p_reason_code text,
  p_correlation_id uuid default null
)
returns app.review_reports
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.resolve_review_report(
    p_moderator_id, p_report_id, p_status, p_reason_code, p_correlation_id
  );
$$;

revoke all on function public.resolve_review_report(uuid, uuid, app.review_report_status, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_review_report(uuid, uuid, app.review_report_status, text, uuid) to service_role;

-- =============================================================================
-- Public read wrappers (doc 86 API SURFACE, law 69).
--
-- These are the ONLY way public content is read. Each one returns published,
-- undeleted rows only, and each returns a deliberate projection rather than a
-- table.
--
-- WHAT IS DELIBERATELY ABSENT FROM THE PUBLIC PROJECTION
--
-- `verified_experience_id` never leaves the database. It points at a private
-- domain row - a task attempt, a withdrawal, a deposit or a support ticket - and
-- law 69 forbids a public review API exposing private financial or support
-- evidence. The badge is public; the evidence is not. The moderation queue
-- wrapper DOES return it, because a moderator investigating authenticity needs
-- it, and that wrapper is not public.
-- =============================================================================

-- Paginated public review list (doc 86 PUBLIC REVIEW SURFACE).
create or replace function public.list_public_reviews(
  p_limit integer default 20,
  p_offset integer default 0,
  p_category text default null,
  p_min_rating integer default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', r.id,
    'rating', r.rating,
    'title', r.title,
    'body', r.body,
    'category', r.category,
    'publishedAt', r.published_at,
    -- Law 64: the badge, and WHICH kind of activity it refers to. Never the id.
    'verificationType', r.verification_type,
    'verifiedExperienceType', r.verified_experience_type,
    'authorDisplayName', pr.display_name,
    -- Doc 86: only APPROVED media is publicly readable. A REJECTED or PENDING
    -- image must not appear even though its parent review is published.
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'storagePath', m.storage_path,
          'mimeType', m.mime_type,
          'width', m.width,
          'height', m.height
        ) order by m.created_at
      )
      from app.review_media m
      where m.review_id = r.id and m.status = 'APPROVED'
    ), '[]'::jsonb)
  )
  from app.reviews r
  left join app.profiles pr on pr.id = r.user_id
  where r.status = 'PUBLISHED'
    and r.deleted_at is null
    and (p_category is null or r.category = p_category)
    and (p_min_rating is null or r.rating >= p_min_rating)
  order by r.published_at desc
  limit least(coalesce(p_limit, 20), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_public_reviews(integer, integer, text, integer) from public, anon, authenticated;
grant execute on function public.list_public_reviews(integer, integer, text, integer) to service_role;

-- Doc 86 RATINGS: the average "should be computed only from reviews that meet
-- publication rules. Removed/rejected content must not continue to affect the
-- public rating". Hence the WHERE clause on both the total and the distribution.
--
-- totalReviews and verifiedReviews are reported SEPARATELY, because doc 86
-- requires the UI to "distinguish total review count from verified-review
-- count" and forbids presenting a user opinion as a verified fact.
create or replace function public.get_review_summary()
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'totalReviews', count(*),
    'verifiedReviews', count(*) filter (where r.verification_type = 'VERIFIED_EXPERIENCE'),
    'averageRating', round(avg(r.rating)::numeric, 2),
    'distribution', coalesce((
      select jsonb_object_agg(d.stars::text, d.n)
      from (
        select x.rating as stars, count(*) as n
        from app.reviews x
        where x.status = 'PUBLISHED' and x.deleted_at is null
        group by x.rating
      ) d
    ), '{}'::jsonb)
  )
  from app.reviews r
  where r.status = 'PUBLISHED' and r.deleted_at is null;
$$;

revoke all on function public.get_review_summary() from public, anon, authenticated;
grant execute on function public.get_review_summary() to service_role;

-- The threaded conversation for one review (doc 86 THREAD / CHAT MODEL).
-- A comment on a review that is no longer published is not returned, even if the
-- comment itself is still PUBLISHED, so restoring a review cannot resurrect a
-- conversation that was hidden with it.
create or replace function public.list_review_comments(
  p_review_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', c.id,
    'parentCommentId', c.parent_comment_id,
    'body', c.body,
    'createdAt', c.created_at,
    'authorDisplayName', pr.display_name,
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'storagePath', m.storage_path,
          'mimeType', m.mime_type,
          'width', m.width,
          'height', m.height
        ) order by m.created_at
      )
      from app.review_comment_media m
      where m.comment_id = c.id and m.status = 'APPROVED'
    ), '[]'::jsonb)
  )
  from app.review_comments c
  join app.reviews r on r.id = c.review_id
  left join app.profiles pr on pr.id = c.user_id
  where c.review_id = p_review_id
    and c.status = 'PUBLISHED'
    and c.deleted_at is null
    and r.status = 'PUBLISHED'
    and r.deleted_at is null
  order by c.created_at
  limit least(coalesce(p_limit, 50), 200);
$$;

revoke all on function public.list_review_comments(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_review_comments(uuid, integer) to service_role;

-- The caller's OWN reviews, in any state, so the author can see what happened to
-- what they wrote (doc 09 TRANSPARENCY applied to content). Scoped to
-- p_user_id, which the route takes from the verified session, never the body.
create or replace function public.list_my_reviews(
  p_user_id uuid,
  p_limit integer default 25
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', r.id,
    'rating', r.rating,
    'title', r.title,
    'body', r.body,
    'category', r.category,
    -- The author is told the real state. A hidden review is still their content,
    -- and silently vanishing is worse than an honest label.
    'status', r.status,
    'verificationType', r.verification_type,
    'verifiedExperienceType', r.verified_experience_type,
    'createdAt', r.created_at,
    'publishedAt', r.published_at,
    'deletedAt', r.deleted_at,
    'mediaCount', (
      select count(*) from app.review_media m where m.review_id = r.id
    )
  )
  from app.reviews r
  where r.user_id = p_user_id
  order by r.created_at desc
  limit least(coalesce(p_limit, 25), 100);
$$;

revoke all on function public.list_my_reviews(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_my_reviews(uuid, integer) to service_role;

-- =============================================================================
-- Moderation surface. NOT public, despite living in `public`.
--
-- These wrappers return private evidence - including the verified_experience_id
-- the public projection deliberately withholds - so they take p_moderator_id and
-- check `review.moderate` IN SQL. Doc 87: "Every sensitive admin action requires
-- permission verification server-side." A revoked operator fails, because the
-- check honours revoked_at.
-- =============================================================================

-- Reviews waiting to be published (doc 86 ADMINISTRATION, 87 dashboard
-- "review reports"). Without this, a fail-closed PENDING default would mean
-- nothing could ever be published.
create or replace function public.list_reviews_awaiting_publication(
  p_moderator_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
begin
  if not app_private.operator_has_capability(p_moderator_id, 'review.moderate') then
    raise exception 'list_reviews_awaiting_publication: the actor does not hold review.moderate'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select jsonb_build_object(
    'id', r.id,
    'userId', r.user_id,
    'rating', r.rating,
    'title', r.title,
    'body', r.body,
    'category', r.category,
    'status', r.status,
    'verificationType', r.verification_type,
    'verifiedExperienceType', r.verified_experience_type,
    -- Moderator-only: the evidence behind a badge, so authenticity can be
    -- investigated without a join to a financial table.
    'verifiedExperienceId', r.verified_experience_id,
    'createdAt', r.created_at,
    'mediaCount', (select count(*) from app.review_media m where m.review_id = r.id)
  )
  from app.reviews r
  where r.status = 'PENDING' and r.deleted_at is null
  order by r.created_at
  limit least(coalesce(p_limit, 50), 200);
end;
$$;

revoke all on function public.list_reviews_awaiting_publication(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_reviews_awaiting_publication(uuid, integer) to service_role;

-- The open report queue, with the content each report points at.
create or replace function public.list_review_reports(
  p_moderator_id uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
begin
  if not app_private.operator_has_capability(p_moderator_id, 'review.moderate') then
    raise exception 'list_review_reports: the actor does not hold review.moderate'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select jsonb_build_object(
    'reportId', rp.id,
    'targetType', rp.target_type,
    'targetId', rp.target_id,
    'reasonCode', rp.reason_code,
    'details', rp.details,
    'status', rp.status,
    'createdAt', rp.created_at,
    -- How many people have flagged the same object. Volume is a triage signal.
    'reportCount', (
      select count(*) from app.review_reports x
      where x.target_type = rp.target_type and x.target_id = rp.target_id
    ),
    'reviewBody', rv.body,
    'reviewRating', rv.rating,
    'reviewStatus', rv.status,
    'authorId', rv.user_id,
    'verifiedExperienceType', rv.verified_experience_type,
    'verifiedExperienceId', rv.verified_experience_id
  )
  from app.review_reports rp
  left join app.reviews rv
    on rp.target_type = 'REVIEW' and rv.id = rp.target_id
  where rp.status in ('OPEN','IN_REVIEW')
  order by rp.created_at
  limit least(coalesce(p_limit, 50), 200);
end;
$$;

revoke all on function public.list_review_reports(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_review_reports(uuid, integer) to service_role;