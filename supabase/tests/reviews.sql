-- =============================================================================
-- pgTAP: Reviews & Community invariants
--
-- Spec: 86_REVIEWS_COMMUNITY_SYSTEM.md, 48_DATABASE_SCHEMA.txt,
--       58_CONTENT_MODERATION.txt, 65_TESTING_STRATEGY.md (REVIEWS / COMMUNITY
--       TESTING), 67_SECURITY_TESTING.md, 71_ARCHITECTURAL_LAWS.md laws 62-70.
--
-- The assertions that matter most here prove a review CANNOT become a financial
-- actor and CANNOT fake its own authenticity. Both are expressed structurally,
-- so they hold even if a later route forgets to check.
-- =============================================================================

begin;

select plan(37);

-- ---------------------------------------------------------------------------
-- Fixtures. Every NOT NULL column is supplied, so the constraint under test is
-- the one that fires rather than an unrelated NOT NULL. The order PostgreSQL
-- enforces is NOT NULL, then CHECK by constraint NAME, then FOREIGN KEY.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap-reviewer@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap-commenter@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'pgtap-moderator@example.invalid', 'x', now(), now(), now());

-- The six tables doc 86 requires.
select has_table('app', 'reviews', 'reviews table exists');
select has_table('app', 'review_media', 'review_media table exists');
select has_table('app', 'review_comments', 'review_comments table exists');
select has_table('app', 'review_comment_media', 'review_comment_media table exists');
select has_table('app', 'review_reports', 'review_reports table exists');
select has_table('app', 'review_moderation_actions', 'review_moderation_actions table exists');

-- The commands must be reachable through the exposed schema, which migration 035
-- established is the only way PostgREST can resolve an RPC at all.
select has_function(
  'public', 'submit_review',
  array['uuid','smallint','text','text','text','app.review_experience_type','text','text','uuid'],
  'the submit_review entry point exists'
);
select has_function(
  'public', 'moderate_review_content',
  array['uuid','app.review_content_target','uuid','app.review_moderation_action','text','text','uuid'],
  'the moderate_review_content entry point exists'
);

-- Doc 86 gives the states; compared as name[] rather than ::text, because
-- pg_enum.enumlabel carries collation C and the ::text form fails on comparison.
select results_eq(
  $$ select array_agg(e.enumlabel order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'app' and t.typname = 'review_status' $$,
  $$ values ('{PENDING,PUBLISHED,HIDDEN,REMOVED}'::name[]) $$,
  'review_status is exactly PENDING, PUBLISHED, HIDDEN, REMOVED'
);

-- Doc 86 lists a Mining Game purchase as a possible qualifying event. It is NOT
-- here, because no game-purchase table exists yet: modelling the value would mean
-- claiming a verification the database cannot perform.
select results_eq(
  $$ select array_agg(e.enumlabel order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'app' and t.typname = 'review_experience_type' $$,
  $$ values ('{TASK_COMPLETION,WITHDRAWAL_COMPLETION,DEPOSIT_CONFIRMATION,SUPPORT_INTERACTION}'::name[]) $$,
  'review_experience_type contains only verifiable qualifying events'
);

-- LAW 63: no column on a review table can hold a financial amount.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'app'
      and table_name in (
        'reviews','review_media','review_comments',
        'review_comment_media','review_reports','review_moderation_actions'
      )
      and column_name ~ '(amount|minor|balance|ledger|payout|fee|reward|deposit|withdraw)'
  ),
  'no review table has a column that could hold a financial amount (law 63)'
);

-- LAW 63, the stronger half: no review table REFERENCES a financial table, so a
-- public review surface cannot be joined to one and leak private evidence.
select results_eq(
  $$
    select count(*) from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in (
        select oid from pg_class
        where relnamespace = 'app'::regnamespace
          and relname in (
            'reviews','review_media','review_comments',
            'review_comment_media','review_reports','review_moderation_actions'
          )
      )
      and c.confrelid in (
        select oid from pg_class
        where relnamespace = 'app'::regnamespace
          and relname in (
            'ledger_entries','ledger_accounts','account_balances','rewards','reward_sources',
            'reward_caps','deposit_requests','withdrawal_requests','payout_destinations',
            'payment_operations','fee_records'
          )
      )
  $$,
  $$ values (0::bigint) $$,
  'no review table has a foreign key to any financial table (law 63)'
);

select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in (
        'reviews','review_media','review_comments',
        'review_comment_media','review_reports','review_moderation_actions'
      )
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every review table'
);

select results_eq(
  $$
    select count(*) from pg_policies
    where schemaname = 'app'
      and tablename in (
        'reviews','review_media','review_comments',
        'review_comment_media','review_reports','review_moderation_actions'
      )
  $$,
  $$ values (0::bigint) $$,
  'no permissive RLS policy exposes review content; access is server-side only'
);

-- LAW 64, expressed as a TYPE: the reference to the qualifying event is an
-- opaque text token, not a uuid foreign key that a public surface could resolve.
select is(
  (select data_type from information_schema.columns
   where table_schema = 'app' and table_name = 'reviews'
     and column_name = 'verified_experience_id'),
  'text',
  'verified_experience_id is opaque text, not a foreign key to a private row'
);

-- ===========================================================================
-- Structural constraints. Each fixture supplies every NOT NULL column and is
-- otherwise valid, so the constraint named in the message is the one that fired.
-- ===========================================================================

select throws_ok(
  $$
    insert into app.reviews (user_id, rating, body, idempotency_key)
    values ('11111111-1111-1111-1111-111111111111', 0, 'body', 'pgtap-rating-zero')
  $$,
  '23514',
  'new row for relation "reviews" violates check constraint "reviews_rating_range"',
  'a rating below 1 is rejected'
);

select throws_ok(
  $$
    insert into app.reviews (user_id, rating, body, idempotency_key)
    values ('11111111-1111-1111-1111-111111111111', 3, '   ', 'pgtap-blank-body')
  $$,
  '23514',
  'new row for relation "reviews" violates check constraint "reviews_body_not_blank"',
  'a whitespace-only review body is rejected'
);

-- LAW 64 in the storage layer: a badge with no evidence cannot be stored at all.
select throws_ok(
  $$
    insert into app.reviews (user_id, rating, body, verification_type, idempotency_key)
    values ('11111111-1111-1111-1111-111111111111', 5, 'body', 'VERIFIED_EXPERIENCE', 'pgtap-badge-no-evidence')
  $$,
  '23514',
  'new row for relation "reviews" violates check constraint "reviews_verification_evidence_consistent"',
  'a Verified Experience with no qualifying event reference is rejected'
);

select throws_ok(
  $$
    insert into app.reviews (user_id, rating, body, status, published_at, idempotency_key)
    values ('11111111-1111-1111-1111-111111111111', 4, 'body', 'PUBLISHED', null, 'pgtap-published-no-time')
  $$,
  '23514',
  'new row for relation "reviews" violates check constraint "reviews_published_at_consistent"',
  'PUBLISHED without a publication timestamp is rejected'
);

-- Doc 86 IMAGE SUPPORT: JPEG, PNG and WebP only. The review_id is a random uuid
-- on purpose: CHECK constraints are evaluated before FOREIGN KEYs, so the mime
-- rule is what fires here.
select throws_ok(
  $$
    insert into app.review_media (review_id, uploader_id, storage_path, mime_type, byte_size)
    values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'pgtap/bad.gif', 'image/gif', 100)
  $$,
  '23514',
  'new row for relation "review_media" violates check constraint "review_media_mime_allowed"',
  'an image type outside the JPEG/PNG/WebP allowlist is rejected'
);

-- Threading integrity. Two reviews and one root comment, then a reply that names
-- a parent from the OTHER review: the composite foreign key must refuse it.
insert into app.reviews (user_id, rating, body, idempotency_key)
values
  ('11111111-1111-1111-1111-111111111111', 4, 'thread A', 'pgtap-thread-a'),
  ('11111111-1111-1111-1111-111111111111', 5, 'thread B', 'pgtap-thread-b');

insert into app.review_comments (review_id, user_id, body, idempotency_key)
select r.id, '22222222-2222-2222-2222-222222222222', 'root comment', 'pgtap-root-comment'
from app.reviews r where r.idempotency_key = 'pgtap-thread-a';

select throws_ok(
  $$
    insert into app.review_comments (review_id, parent_comment_id, user_id, body, idempotency_key)
    select b.id, c.id, '22222222-2222-2222-2222-222222222222', 'cross-thread', 'pgtap-cross-comment'
    from app.reviews b
    cross join app.review_comments c
    where b.idempotency_key = 'pgtap-thread-b'
      and c.idempotency_key = 'pgtap-root-comment'
  $$,
  '23503',
  'insert or update on table "review_comments" violates foreign key constraint "review_comments_parent_same_review"',
  'a reply cannot be grafted onto a different review thread'
);

-- ===========================================================================
-- Command behaviour. These go through the app_private commands, which is the
-- path the API actually takes.
-- ===========================================================================

select is(
  (select r.status from app_private.submit_review(
    p_user_id => '11111111-1111-1111-1111-111111111111',
    p_rating => 4::smallint,
    p_body => 'A genuine review body written by the author.',
    p_idempotency_key => 'pgtap-submit-1'
  ) r),
  'PENDING',
  'submit_review creates a review in PENDING, so nothing is public unreviewed'
);

select is(
  (select r.verification_type from app_private.submit_review(
    p_user_id => '11111111-1111-1111-1111-111111111111',
    p_rating => 4::smallint,
    p_body => 'A genuine review body written by the author.',
    p_idempotency_key => 'pgtap-submit-1'
  ) r),
  'UNVERIFIED',
  'an ordinary review is UNVERIFIED: a badge is never self-asserted'
);

-- LAW 64, the enforcement that matters: a review may not claim a Verified
-- Experience for an event that does not exist or is not the author's.
select throws_ok(
  $$
    select app_private.submit_review(
      p_user_id => '11111111-1111-1111-1111-111111111111',
      p_rating => 5::smallint,
      p_body => 'Trying to claim a badge',
      p_verified_experience_type => 'TASK_COMPLETION',
      p_verified_experience_id => '00000000-0000-0000-0000-000000000000',
      p_idempotency_key => 'pgtap-fake-badge'
    )
  $$,
  '23514',
  'submit_review: the referenced qualifying event does not exist for this user, so it cannot be presented as a Verified Experience',
  'a Verified Experience backed by a nonexistent event is refused, not downgraded'
);

-- Doc 86 acceptance 18: a retry must not create a second review.
select is(
  (select count(*) from app.reviews where idempotency_key = 'pgtap-submit-1'),
  1::bigint,
  're-submitting with the same idempotency key produced no duplicate review'
);

-- Doc 87: every sensitive admin action verifies permission server-side. This
-- actor is a normal user, not a moderator.
select throws_ok(
  $$
    select app_private.moderate_review_content(
      '22222222-2222-2222-2222-222222222222', 'REVIEW',
      (select id from app.reviews where idempotency_key = 'pgtap-submit-1'),
      'APPROVE', 'SHOULD_NOT_WORK'
    )
  $$,
  '42501',
  'moderate_review_content: the actor does not hold review.moderate',
  'an actor without review.moderate cannot moderate, even by calling the function'
);

-- Doc 86 RATINGS: only published reviews count. Three reviews exist and none is
-- published yet.
select is(
  (select (public.get_review_summary() ->> 'totalReviews')::bigint),
  0::bigint,
  'the public rating counts only published reviews, so it is still zero'
);

-- A reply is only accepted on a published review.
select throws_ok(
  $$
    select app_private.submit_review_comment(
      '22222222-2222-2222-2222-222222222222',
      (select id from app.reviews where idempotency_key = 'pgtap-submit-1'),
      'Replying to something nobody can see', null, 'pgtap-unpublished-reply'
    )
  $$,
  '23514',
  'submit_review_comment: this review is not open for replies',
  'a reply to an unpublished review is refused'
);

-- A report against a target that does not exist is a probe, not a report. The
-- message carries the substituted target type, so it is asserted in full.
select throws_ok(
  $$
    select app_private.report_review_content(
      '22222222-2222-2222-2222-222222222222', 'REVIEW',
      '00000000-0000-0000-0000-000000000000', 'SPAM'
    )
  $$,
  'P0002',
  'report_review_content: unknown REVIEW target',
  'a report against a nonexistent target is refused'
);

-- ===========================================================================
-- Moderation, publication, and the public read surface.
-- ===========================================================================

-- Grant the moderator a role that actually holds review.moderate, selected from
-- the capability table rather than hardcoded, so this fixture cannot drift from
-- the seed. If no role held it, the insert would add nothing and the assertions
-- below would fail loudly rather than passing vacuously.
insert into app.admin_users (user_id, role_code)
select '33333333-3333-3333-3333-333333333333', rc.role_code
from app.admin_role_capabilities rc
where rc.capability_code = 'review.moderate'
order by rc.role_code
limit 1;

select is(
  (select a.action from app_private.moderate_review_content(
    '33333333-3333-3333-3333-333333333333', 'REVIEW',
    (select id from app.reviews where idempotency_key = 'pgtap-submit-1'),
    'APPROVE', 'PUBLISHED_AFTER_REVIEW'
  ) a),
  'APPROVE',
  'a holder of review.moderate can publish a pending review'
);

select is(
  (select r.status from app.reviews r where r.idempotency_key = 'pgtap-submit-1'),
  'PUBLISHED',
  'the moderated review is now PUBLISHED'
);

-- The moderation log is append-only; a correction must be a NEW action.
select throws_ok(
  $$
    update app.review_moderation_actions
       set reason_code = 'tampered'
     where id = (select min(id) from app.review_moderation_actions)
  $$,
  '23001',
  'append-only table: review_moderation_actions cannot be update',
  'a moderation decision cannot be edited after the fact'
);

select is(
  (select (public.get_review_summary() ->> 'totalReviews')::bigint),
  1::bigint,
  'the published review now counts toward the public rating'
);

-- The population is asserted BEFORE the absence of a field, so "no
-- verifiedExperienceId" cannot be satisfied by an empty result set. A check that
-- filters the population first is how a leak survived in this project once.
select is(
  (select count(*) from public.list_public_reviews(10, 0, null, null)),
  1::bigint,
  'the public review list returns the published review'
);

select ok(
  not exists (
    select 1
    from jsonb_object_keys(
      (select * from public.list_public_reviews(10, 0, null, null) limit 1)
    ) as k
    where k = 'verifiedExperienceId'
  ),
  'the public projection never exposes verified_experience_id (law 69)'
);

-- Every public function in this schema must revoke the anon EXECUTE grant.
-- Migration 036 exists because 29 did not (Q-22).
select ok(
  not has_function_privilege(
    'anon', 'public.list_public_reviews(integer,integer,text,integer)', 'EXECUTE'
  ),
  'an unauthenticated caller cannot execute the public review read wrapper'
);

select throws_ok(
  $$
    select public.list_review_reports('44444444-4444-4444-4444-444444444444', 10)
  $$,
  '42501',
  'list_review_reports: the actor does not hold review.moderate',
  'the moderation queue refuses an actor without review.moderate'
);

select * from finish();

rollback;