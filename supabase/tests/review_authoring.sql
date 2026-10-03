-- =============================================================================
-- pgTAP: Review authoring commands and the reply outbox (migration 042)
--
-- Spec: 86_REVIEWS_COMMUNITY_SYSTEM.md (API SURFACE PATCH/DELETE/media,
--       NOTIFICATIONS, PRIVACY), 71_ARCHITECTURAL_LAWS.md laws 63-69.
--
-- The rules under test are all AUTHORITY rules: who may change a row, when they
-- may change it, and what the row must not be able to reach. None of them is
-- about formatting.
-- =============================================================================

begin;

-- 26 assertions, counted one at a time against the file rather than estimated:
--   5 has_function, 4 ownership throws_ok, 4 happy-path, 6 published/soft-delete,
--   5 outbox (including the control), 2 law 63 / enum.
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures. Three users so cross-user access is testable: an author, a stranger
-- and a moderator. Every NOT NULL column on auth.users is supplied.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'pgtap-author@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'pgtap-stranger@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666',
   'authenticated', 'authenticated', 'pgtap-replier@example.invalid', 'x', now(), now(), now());

-- The author's own review. Left PENDING, because `update_review` correctly refuses
-- to edit a published row and section 3 needs something editable.
create temporary table t_review on commit drop as
  select (app_private.submit_review(
    p_user_id => '44444444-4444-4444-4444-444444444444',
    p_rating => 3::smallint,
    p_body => 'Original body text.',
    p_title => 'Original title',
    p_idempotency_key => 'pgtap-042-review'
  )).id as id;

-- A SEPARATE, already-published review for the reply to hang on.
--
-- `submit_review_comment` REFUSES to reply to anything that is not PUBLISHED, so a
-- fixture that builds the comment straight off `submit_review` dies on its second
-- statement and the whole suite produces ZERO assertions. That is exactly what
-- happened on the first run of this file. Publishing first is the fix, and using a
-- separate row keeps the editable PENDING review available for section 3.
insert into app.reviews (
  user_id, rating, body, idempotency_key, status, published_at
) values (
  '44444444-4444-4444-4444-444444444444', 4::smallint,
  'A published review that can receive replies.', 'pgtap-042-published',
  'PUBLISHED', now()
);

create temporary table t_comment on commit drop as
  select (app_private.submit_review_comment(
    p_user_id => '66666666-6666-6666-6666-666666666666',
    p_review_id => (select id from app.reviews where idempotency_key = 'pgtap-042-published'),
    p_body => 'Original reply text.',
    p_idempotency_key => 'pgtap-042-comment'
  )).id as id;

-- ---------------------------------------------------------------------------
-- 1. The commands exist and are reachable through the exposed schema
-- ---------------------------------------------------------------------------

select has_function('public', 'update_review',
  array['uuid','uuid','text','text','smallint'],
  'the update_review entry point exists');
select has_function('public', 'delete_review',
  array['uuid','uuid'],
  'the delete_review entry point exists');
select has_function('public', 'update_review_comment',
  array['uuid','uuid','text'],
  'the update_review_comment entry point exists');
select has_function('public', 'delete_review_comment',
  array['uuid','uuid'],
  'the delete_review_comment entry point exists');
select has_function('public', 'attach_review_comment_media',
  array['uuid','uuid','text','text','bigint','integer','integer','boolean','uuid'],
  'the attach_review_comment_media entry point exists: the table had no writer');

-- ---------------------------------------------------------------------------
-- 2. Ownership. THE IDOR boundary (doc 67 BOLA).
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select app_private.update_review(
       p_user_id => '55555555-5555-5555-5555-555555555555',
       p_review_id => (select id from t_review),
       p_body => 'hijacked' ) $$,
  'P0002',
  'update_review: unknown review',
  'a stranger cannot edit a review they do not own'
);

select throws_ok(
  $$ select app_private.delete_review(
       p_user_id => '55555555-5555-5555-5555-555555555555',
       p_review_id => (select id from t_review) ) $$,
  'P0002',
  'delete_review: unknown review',
  'a stranger cannot delete a review they do not own'
);

select throws_ok(
  $$ select app_private.update_review_comment(
       p_user_id => '55555555-5555-5555-5555-555555555555',
       p_comment_id => (select id from t_comment),
       p_body => 'hijacked' ) $$,
  'P0002',
  'update_review_comment: unknown comment',
  'a stranger cannot edit a reply they do not own'
);

select throws_ok(
  $$ select app_private.attach_review_comment_media(
       p_uploader_id => '55555555-5555-5555-5555-555555555555',
       p_comment_id => (select id from t_comment),
       p_storage_path => '55555555/review/reply.jpg',
       p_mime_type => 'image/jpeg',
       p_byte_size => 2048 ) $$,
  '23514',
  'attach_review_comment_media: this comment does not belong to the caller',
  'a stranger cannot attach an image to a reply they do not own'
);

-- ---------------------------------------------------------------------------
-- 3. The happy paths actually write
-- ---------------------------------------------------------------------------

select is(
  (select r.title from app_private.update_review(
     p_user_id => '44444444-4444-4444-4444-444444444444',
     p_review_id => (select id from t_review),
     p_body => 'Corrected body text.',
     p_title => 'Corrected title' ) r),
  'Corrected title',
  'the author can edit their own review'
);

select is(
  (select r.body from app_private.update_review_comment(
     p_user_id => '66666666-6666-6666-6666-666666666666',
     p_comment_id => (select id from t_comment),
     p_body => 'Corrected reply text.' ) r),
  'Corrected reply text.',
  'the author can edit their own reply'
);

select is(
  (select m.mime_type from app_private.attach_review_comment_media(
     p_uploader_id => '66666666-6666-6666-6666-666666666666',
     p_comment_id => (select id from t_comment),
     p_storage_path => '66666666/review/reply.jpg',
     p_mime_type => 'image/jpeg',
     p_byte_size => 2048,
     p_metadata_stripped => true ) m),
  'image/jpeg',
  'the reply author can attach an image to their own reply'
);

-- The allowlist is enforced in the command AND by the table CHECK, so a wrong
-- type is refused whichever layer is reached.
select throws_ok(
  $$ select app_private.attach_review_comment_media(
       p_uploader_id => '66666666-6666-6666-6666-666666666666',
       p_comment_id => (select id from t_comment),
       p_storage_path => '66666666/review/reply.svg',
       p_mime_type => 'image/svg+xml',
       p_byte_size => 1024 ) $$,
  '23514',
  'attach_review_comment_media: unsupported image type image/svg+xml',
  'an image type outside the doc 86 allowlist is refused'
);

-- ---------------------------------------------------------------------------
-- 4. A PUBLISHED row may not be edited in place, and may only be removed softly
-- ---------------------------------------------------------------------------

update app.reviews set status = 'PUBLISHED', published_at = now()
where id = (select id from t_review);

select throws_ok(
  $$ select app_private.update_review(
       p_user_id => '44444444-4444-4444-4444-444444444444',
       p_review_id => (select id from t_review),
       p_body => 'rewritten after publication' ) $$,
  '23514',
  'update_review: only a review that is not yet published can be edited',
  'a published review cannot have its text rewritten in place'
);

-- `review_comments` has NO `published_at` column (unlike `reviews`, whose
-- `reviews_published_at_consistent` constraint requires the pair). Migration 038
-- models a comment as PENDING/PUBLISHED without a publication timestamp, so this
-- sets status only. The first draft set both and aborted the suite.
update app.review_comments set status = 'PUBLISHED'
where id = (select id from t_comment);

select throws_ok(
  $$ select app_private.update_review_comment(
       p_user_id => '66666666-6666-6666-6666-666666666666',
       p_comment_id => (select id from t_comment),
       p_body => 'rewritten after publication' ) $$,
  '23514',
  'update_review_comment: only a comment that is not yet published can be edited',
  'a published reply cannot have its text rewritten in place'
);

-- Soft delete sets deleted_at. Doc 09 transparency and doc 67 both require the
-- record to REMAIN, so this asserts the row still exists rather than a status.
select is(
  (select r.deleted_at is not null from app_private.delete_review(
     p_user_id => '44444444-4444-4444-4444-444444444444',
     p_review_id => (select id from t_review) ) r),
  true,
  'delete_review soft-deletes by setting deleted_at'
);

select is(
  (select count(*)::int from app.reviews where id = (select id from t_review)),
  1,
  'a deleted review still EXISTS: history is never rewritten (doc 09, doc 67)'
);

select is(
  (select r.deleted_at is not null from app_private.delete_review_comment(
     p_user_id => '66666666-6666-6666-6666-666666666666',
     p_comment_id => (select id from t_comment) ) r),
  true,
  'delete_review_comment soft-deletes by setting deleted_at'
);

-- Idempotent: a second delete satisfies the intent rather than raising.
--
-- The comparison is on `id`, NOT `... is not null`. In PostgreSQL, `composite IS NOT
-- NULL` is true only when EVERY field of the row is non-null, and `app.reviews` has
-- nullable columns (`title`, `published_at`, `verified_experience_id`, ...). So the
-- original `... is not null` returned false on a perfectly good row and the test
-- failed for a reason that had nothing to do with idempotency.
select is(
  (select (app_private.delete_review(
     p_user_id => '44444444-4444-4444-4444-444444444444',
     p_review_id => (select id from t_review) )).id::text),
  (select id::text from app.reviews where id = (select id from t_review)),
  'deleting twice returns the same row rather than raising'
);

-- ---------------------------------------------------------------------------
-- 5. The reply outbox event
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_comment)),
  1,
  'a reply enqueues exactly one review.comment.added event'
);

select is(
  (select (payload->>'reviewAuthorId') from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_comment)),
  '44444444-4444-4444-4444-444444444444',
  'the event names the REVIEW author as the recipient, not the replier'
);

-- Doc 86 PRIVACY: the payload must not carry the comment body. The comment is
-- still PENDING when this fires, so its text has not been moderated.
select is(
  (select (payload ? 'body') from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_comment)),
  false,
  'the reply event carries NO comment text: unmoderated text must not leave via a notification'
);

-- No self-notification: an author replying to their own review gets nothing.
-- The review MUST be published first: `submit_review_comment` refuses to reply to
-- anything that is not PUBLISHED, so a PENDING fixture here would abort the whole
-- suite rather than test what it claims.
insert into app.reviews (user_id, rating, body, idempotency_key)
values ('55555555-5555-5555-5555-555555555555', 5::smallint, 'Self review.', 'pgtap-042-self');

update app.reviews set status = 'PUBLISHED', published_at = now()
where idempotency_key = 'pgtap-042-self';

-- The comment is CREATED in its own statement; the event is COUNTED in the next.
--
-- Doing both in one statement cannot work: the outer count uses the statement's
-- snapshot, which predates the outbox row the scalar subquery inserts. The first
-- draft did exactly that, and this assertion therefore PASSED VACUOUSLY - it would
-- have reported zero even if the trigger had fired for a self-reply. It was the
-- CONTROL assertion that exposed it, by also reporting zero when it owed one.
create temporary table t_self_reply on commit drop as
  select (app_private.submit_review_comment(
    p_user_id => '55555555-5555-5555-5555-555555555555',
    p_review_id => (select id from app.reviews where idempotency_key = 'pgtap-042-self'),
    p_body => 'Replying to my own review.',
    p_idempotency_key => 'pgtap-042-self-reply' )).id as id;

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_self_reply)),
  0,
  'replying to your own review enqueues nothing: no self-notification'
);

-- The CONTROL, and the reason the create/count split above exists. Same review,
-- different author, immediately after. Without it, the zero above could simply
-- mean "the trigger never fires at all", and the suite would pass for the
-- wrong reason.
create temporary table t_foreign_reply on commit drop as
  select (app_private.submit_review_comment(
    p_user_id => '66666666-6666-6666-6666-666666666666',
    p_review_id => (select id from app.reviews where idempotency_key = 'pgtap-042-self'),
    p_body => 'A genuine reply from someone else.',
    p_idempotency_key => 'pgtap-042-foreign-reply' )).id as id;

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_foreign_reply)),
  1,
  'CONTROL: a reply from another user DOES enqueue, so the zero above means self-notification'
);
-- ---------------------------------------------------------------------------
-- 6. Law 63 by absence, and the new enum member
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname in (
       'update_review','delete_review','update_review_comment',
       'delete_review_comment','attach_review_comment_media'
     )
     and (
       p.prosrc like '%post_ledger_entry%'
       or p.prosrc like '%grant_reward%'
       or p.prosrc like '%create_withdrawal_request%'
       or p.prosrc like '%ledger_entries%'
       or p.prosrc like '%paid_perk_orders%'
     )),
  0,
  'LAW 63: no review authoring command can reach a money primitive'
);

select is(
  (select count(*)::int from pg_type t
   join pg_namespace n on n.oid = t.typnamespace
   join pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'app' and t.typname = 'notification_category'
     and e.enumlabel = 'COMMUNITY'),
  1,
  'the COMMUNITY notification category exists for factual reply alerts'
);

select * from finish();

rollback;
