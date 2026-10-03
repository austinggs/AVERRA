-- =============================================================================
-- Averra migration 042: Review authoring commands and the reply outbox
--
-- Source of truth: 86_REVIEWS_COMMUNITY_SYSTEM.md (API SURFACE lines 203-209,
--                  NOTIFICATIONS line 220, PRIVACY), 49_API_SPECIFICATION.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 63-69, doc 80
--
-- WHAT THIS FILLS IN
--
-- Migration 039 shipped the submission, moderation and read surface. It shipped
-- NO author-editing commands, so four endpoints in doc 86's API SURFACE had
-- nothing to call:
--
--     PATCH /reviews/:id                  -> app_private.update_review
--     DELETE /reviews/:id                 -> app_private.delete_review
--     PATCH /reviews/comments/:id         -> app_private.update_review_comment
--     DELETE /reviews/comments/:id        -> app_private.delete_review_comment
--     POST  /reviews/comments/:id/media   -> app_private.attach_review_comment_media
--
-- The last one is the notable gap: migration 038 created
-- `app.review_comment_media` with its own status column, its own indexes and its
-- own constraints, and NOTHING EVER WROTE TO IT. Doc 86 IMAGE SUPPORT says "Replies
-- may also contain images", so the table was unreachable by construction.
--
-- WHY DELETION IS SOFT
--
-- `deleted_at` is set, the row stays. Doc 09 TRANSPARENCY applied to content
-- means the author must still be able to see that their review existed and what
-- happened to it, and doc 67 requires the moderation trail to survive a takedown.
-- A hard delete would destroy the evidence a dispute later needs. This matches
-- the `deleted_at` column that migration 038 already put on both tables and that
-- every read wrapper in 039 already filters on.
--
-- WHY THE REPLY NOTIFICATION IS A TRIGGER
--
-- Migration 039 writes NO outbox event, so `submit_review_comment` has nothing to
-- notify from. The obvious fix is to `create or replace` that function and add the
-- insert - which means retyping an eighty-line body that is already applied and
-- reviewed, which is how function bodies get corrupted in this repository.
--
-- A trigger avoids that entirely: it is additive, it fires inside the same
-- transaction as the INSERT by construction, and it leaves migration 039
-- untouched. The outbox guarantee ("written in the same transaction as any state
-- change") is satisfied structurally rather than by remembering to add a line.
--
-- LAW 63 IS STILL ENFORCED BY ABSENCE
--
-- Nothing in this file touches ledger_entries, rewards, deposits, withdrawals or
-- balances. Editing a review moves no money, and the notification it may trigger
-- is a factual system event, never generated text.
-- =============================================================================

-- Doc 86 NOTIFICATIONS require a factual in-app notification. `COMMUNITY` is added
-- rather than reusing `SYSTEM`, because a user filtering their alerts should be
-- able to separate "someone replied to you" from generic platform notices.
--
-- ADD VALUE ... IF NOT EXISTS because this migration is meant to be re-runnable.
alter type app.notification_category add value if not exists 'COMMUNITY';

-- -----------------------------------------------------------------------------
-- update_review: the author edits their own review
-- -----------------------------------------------------------------------------
-- Ownership is checked by the SAME user id the route passes, which the route takes
-- from a verified session and never from the body. Both conditions matter: the row
-- lookup is scoped by user_id, so another author's review is reported as "unknown"
-- rather than "forbidden", which would otherwise confirm the id exists.
create or replace function app_private.update_review(
  p_user_id uuid,
  p_review_id uuid,
  p_body text,
  p_title text default null,
  p_rating smallint default null
)
returns app.reviews
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_review app.reviews;
begin
  select * into v_review from app.reviews r
  where r.id = p_review_id and r.user_id = p_user_id;

  if not found then
    raise exception 'update_review: unknown review'
      using errcode = 'no_data_found';
  end if;

  if v_review.deleted_at is not null then
    raise exception 'update_review: this review has been deleted'
      using errcode = 'check_violation';
  end if;

  -- Only an UNPUBLISHED review may be edited. Editing a live published review in
  -- place would rewrite text other people have already read and replied to, which
  -- is a history rewrite wearing a UI. Doc 09 transparency: author the first copy,
  -- and if it was wrong, take it down explicitly.
  if v_review.status <> 'PENDING' then
    raise exception 'update_review: only a review that is not yet published can be edited'
      using errcode = 'check_violation';
  end if;

  update app.reviews
  set body = p_body,
      title = p_title,
      rating = coalesce(p_rating, rating)
  where id = p_review_id
  returning * into v_review;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.updated', 'review', p_review_id::text, 'SUCCESS',
    jsonb_build_object('rating', v_review.rating, 'title', v_review.title)
  );

  return v_review;
end;
$$;

revoke all on function app_private.update_review(uuid, uuid, text, text, smallint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- delete_review: the author takes down their own review. SOFT.
-- -----------------------------------------------------------------------------
create or replace function app_private.delete_review(
  p_user_id uuid,
  p_review_id uuid
)
returns app.reviews
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_review app.reviews;
begin
  select * into v_review from app.reviews r
  where r.id = p_review_id and r.user_id = p_user_id;

  if not found then
    raise exception 'delete_review: unknown review'
      using errcode = 'no_data_found';
  end if;

  -- Idempotent by design: a second delete returns the same row rather than
  -- raising, because the author's intent is already satisfied.
  if v_review.deleted_at is not null then
    return v_review;
  end if;

  update app.reviews
  set deleted_at = now()
  where id = p_review_id
  returning * into v_review;

  -- Doc 67: the moderation trail must survive a takedown. The row stays; only its
  -- visibility changes. Every read wrapper in 039 already filters `deleted_at`.
  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.deleted_by_author', 'review', p_review_id::text, 'SUCCESS',
    jsonb_build_object('deletedAt', v_review.deleted_at)
  );

  return v_review;
end;
$$;

revoke all on function app_private.delete_review(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- update_review_comment / delete_review_comment
-- -----------------------------------------------------------------------------
-- Same rules as the review: own content only, unpublished only, soft delete.
create or replace function app_private.update_review_comment(
  p_user_id uuid,
  p_comment_id uuid,
  p_body text
)
returns app.review_comments
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_comment app.review_comments;
begin
  select * into v_comment from app.review_comments c
  where c.id = p_comment_id and c.user_id = p_user_id;

  if not found then
    raise exception 'update_review_comment: unknown comment'
      using errcode = 'no_data_found';
  end if;

  if v_comment.deleted_at is not null then
    raise exception 'update_review_comment: this comment has been deleted'
      using errcode = 'check_violation';
  end if;

  if v_comment.status <> 'PENDING' then
    raise exception 'update_review_comment: only a comment that is not yet published can be edited'
      using errcode = 'check_violation';
  end if;

  update app.review_comments set body = p_body where id = p_comment_id
  returning * into v_comment;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.comment_updated', 'review', p_comment_id::text, 'SUCCESS',
    jsonb_build_object('commentId', p_comment_id)
  );

  return v_comment;
end;
$$;

revoke all on function app_private.update_review_comment(uuid, uuid, text) from public, anon, authenticated;

create or replace function app_private.delete_review_comment(
  p_user_id uuid,
  p_comment_id uuid
)
returns app.review_comments
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_comment app.review_comments;
begin
  select * into v_comment from app.review_comments c
  where c.id = p_comment_id and c.user_id = p_user_id;

  if not found then
    raise exception 'delete_review_comment: unknown comment'
      using errcode = 'no_data_found';
  end if;

  if v_comment.deleted_at is not null then
    return v_comment;
  end if;

  update app.review_comments set deleted_at = now() where id = p_comment_id
  returning * into v_comment;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_user_id, 'review.comment_deleted_by_author', 'review',
    p_comment_id::text, 'SUCCESS', jsonb_build_object('deletedAt', v_comment.deleted_at)
  );

  return v_comment;
end;
$$;

revoke all on function app_private.delete_review_comment(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- attach_review_comment_media: the writer `review_comment_media` never had
-- -----------------------------------------------------------------------------
-- Mirrors `attach_review_media` (migration 039) deliberately, including its IDOR
-- check. `p_mime_type` is the type the SERVER derived from the actual bytes, not
-- the client-reported one (doc 86 IMAGE SUPPORT); the table's own CHECK constraint
-- rejects anything outside the JPEG/PNG/WebP allowlist regardless.
--
-- The ownership check reaches the comment's author through the comment, so an
-- upload cannot be attached to somebody else's reply.
create or replace function app_private.attach_review_comment_media(
  p_uploader_id uuid,
  p_comment_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null,
  p_metadata_stripped boolean default false,
  p_correlation_id uuid default null
)
returns app.review_comment_media
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_comment app.review_comments;
  v_media app.review_comment_media;
begin
  select c.* into v_comment from app.review_comments c where c.id = p_comment_id;

  if not found then
    raise exception 'attach_review_comment_media: unknown comment'
      using errcode = 'no_data_found';
  end if;

  if v_comment.user_id <> p_uploader_id then
    raise exception 'attach_review_comment_media: this comment does not belong to the caller'
      using errcode = 'check_violation';
  end if;

  if v_comment.deleted_at is not null then
    raise exception 'attach_review_comment_media: this comment has been deleted'
      using errcode = 'check_violation';
  end if;

  if p_mime_type not in ('image/jpeg','image/png','image/webp') then
    raise exception 'attach_review_comment_media: unsupported image type %', p_mime_type
      using errcode = 'check_violation';
  end if;

  insert into app.review_comment_media (
    comment_id, uploader_id, storage_path, mime_type, byte_size,
    width, height, metadata_stripped
  ) values (
    p_comment_id, p_uploader_id, p_storage_path, p_mime_type, p_byte_size,
    p_width, p_height, coalesce(p_metadata_stripped, false)
  )
  returning * into v_media;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    p_uploader_id, 'review.comment_media_attached', 'review',
    p_comment_id::text, 'SUCCESS',
    jsonb_build_object('mediaId', v_media.id, 'byteSize', p_byte_size)
  );

  return v_media;
end;
$$;

revoke all on function app_private.attach_review_comment_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reply notifications (doc 86 NOTIFICATIONS)
-- -----------------------------------------------------------------------------
-- Enqueues a factual `review.comment.added` event in the SAME transaction as the
-- comment INSERT. See the header for why this is a trigger rather than a change to
-- migration 039's function body.
--
-- THREE RULES, each of which is a deliberate decision rather than a default:
--
-- 1. NO SELF-NOTIFICATION. Someone replying to their own review must not receive
--    an alert for it. The comparison is against the REVIEW author, and the
--    author's own reply is the overwhelmingly common case.
-- 2. ONLY THE REVIEW AUTHOR IS NOTIFIED. A reply-to-a-reply is included, because
--    doc 86 describes a THREAD and a thread that never alerts anyone is a
--    conversation nobody is in. Parent-comment authors are not separately
--    notified; inventing a second recipient path is not stated by the spec.
-- 3. THE PAYLOAD CARRIES NO COMMENT TEXT. Only ids and the review title. Doc 86
--    PRIVACY: a notification must not become a channel for content that has not
--    been moderated yet, and the comment is still PENDING at this moment.
create or replace function app_private.enqueue_review_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_review_author uuid;
begin
  select r.user_id into v_review_author
  from app.reviews r where r.id = new.review_id;

  -- No author (deleted review) or a self-reply: nothing to tell.
  if v_review_author is null or v_review_author = new.user_id then
    return new;
  end if;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'review.comment.added', 'review_comment', new.id::text,
    jsonb_build_object(
      'commentId', new.id,
      'reviewId', new.review_id,
      'reviewAuthorId', v_review_author,
      'commentAuthorId', new.user_id,
      'parentCommentId', new.parent_comment_id,
      'reviewTitle', (select r.title from app.reviews r where r.id = new.review_id)
    )
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function app_private.enqueue_review_comment_notification() from public, anon, authenticated;

drop trigger if exists trg_review_comment_notification on app.review_comments;

create trigger trg_review_comment_notification
  after insert on app.review_comments
  for each row execute function app_private.enqueue_review_comment_notification();

-- =============================================================================
-- Public entry points (the migration-035 pattern).
--
-- PostgREST resolves an RPC only against an EXPOSED schema, and `app_private` is
-- deliberately not exposed - doing so would publish every internal money function
-- in the platform at once. Each function below is a thin, same-signature delegate
-- that adds no logic and makes no decision; the `app_private` command remains the
-- authority.
--
-- Every one revokes `public, anon, authenticated` BEFORE granting, or
-- `npm run check:grants` fails the build. This is the migration-036 lesson (Q-22),
-- where 29 wrappers were born executable by an unauthenticated caller holding only
-- the publishable key.
-- =============================================================================

create or replace function public.update_review(
  p_user_id uuid,
  p_review_id uuid,
  p_body text,
  p_title text default null,
  p_rating smallint default null
)
returns app.reviews
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.update_review(p_user_id, p_review_id, p_body, p_title, p_rating);
$$;

revoke all on function public.update_review(uuid, uuid, text, text, smallint) from public, anon, authenticated;
grant execute on function public.update_review(uuid, uuid, text, text, smallint) to service_role;

create or replace function public.delete_review(
  p_user_id uuid,
  p_review_id uuid
)
returns app.reviews
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.delete_review(p_user_id, p_review_id);
$$;

revoke all on function public.delete_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_review(uuid, uuid) to service_role;

create or replace function public.update_review_comment(
  p_user_id uuid,
  p_comment_id uuid,
  p_body text
)
returns app.review_comments
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.update_review_comment(p_user_id, p_comment_id, p_body);
$$;

revoke all on function public.update_review_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.update_review_comment(uuid, uuid, text) to service_role;

create or replace function public.delete_review_comment(
  p_user_id uuid,
  p_comment_id uuid
)
returns app.review_comments
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.delete_review_comment(p_user_id, p_comment_id);
$$;

revoke all on function public.delete_review_comment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_review_comment(uuid, uuid) to service_role;

create or replace function public.attach_review_comment_media(
  p_uploader_id uuid,
  p_comment_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null,
  p_metadata_stripped boolean default false,
  p_correlation_id uuid default null
)
returns app.review_comment_media
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.attach_review_comment_media(
    p_uploader_id, p_comment_id, p_storage_path, p_mime_type, p_byte_size,
    p_width, p_height, p_metadata_stripped, p_correlation_id
  );
$$;

revoke all on function public.attach_review_comment_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.attach_review_comment_media(uuid, uuid, text, text, bigint, integer, integer, boolean, uuid) to service_role;