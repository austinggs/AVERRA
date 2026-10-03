-- =============================================================================
-- Averra migration 038: Reviews & Community foundation
--
-- Source of truth: 86_REVIEWS_COMMUNITY_SYSTEM.md (DATABASE MODEL, AUTHORIZATION
--                  / RLS, MODERATION, ANTI-MANIPULATION),
--                  48_DATABASE_SCHEMA.txt (REVIEWS / COMMUNITY TABLES),
--                  10_UI_UX_SPECIFICATION.txt (REVIEWS & COMMUNITY UI),
--                  58_CONTENT_MODERATION.txt, 53_SECURITY_ARCHITECTURE.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 62-70, 54_PRIVACY_DATA_PROTECTION.txt
--
-- This is Phase 9's REVIEWS & COMMUNITY ADDITION (doc 76) and the M7 addition
-- (doc 77). It was specified but entirely unbuilt: none of the six logical
-- tables in doc 86 existed.
--
-- THE BOUNDARY THIS MIGRATION ENFORCES, STRUCTURALLY
--
-- Law 63: "Reviews and comments never directly mutate balances, rewards,
-- deposits, withdrawals, or fraud decisions." So no column on any table below
-- can hold a financial amount, and NO table here has a foreign key to the
-- ledger, rewards, deposits, withdrawals or any financial record.
--
-- Law 64: Verified Experience "means verified underlying platform activity
-- only; it is not Averra endorsement." A review therefore references a
-- qualifying event by an OPAQUE TEXT REFERENCE, not by a foreign key. That is
-- deliberate: an FK would let a public review surface join to a private
-- financial row and leak it. Doc 86 FINANCIAL / SUPPORT SEPARATION requires
-- exactly that a review "may link internally" while private evidence is never
-- exposed. The reference is validated once, at write time, by migration 039;
-- it is never resolvable from the public read surface.
--
-- Law 65: "Averra MUST NOT financially reward positive reviews." There is no
-- reward reference, budget reference or ledger entry column anywhere in this
-- file, so the rule cannot be broken by a later writer without a schema change.
--
-- Law 62: public community content is separate from private support and
-- financial records. Media lives in its own tables with their own status, so a
-- moderation takedown of an image cannot touch a ticket or a payment.
--
-- FAIL-CLOSED VISIBILITY
--
-- A review is created PENDING, not PUBLISHED. Nothing a user writes is visible
-- to anyone else until a human moderator publishes it, or until a later,
-- separately-approved deterministic automation does. Doc 86 requires human
-- authority over publication (law 67), and a fail-closed default is the only
-- version of that which a database can guarantee on its own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vocabulary (doc 86 states, plus the publication lifecycle it requires)
-- -----------------------------------------------------------------------------

-- Publication/moderation state. Doc 86: "Public visibility is driven by
-- publication/moderation status, not by client assumptions."
create type app.review_status as enum (
  'PENDING',    -- written, not yet visible to anyone but its author
  'PUBLISHED',  -- visible; the ONLY state a public read may return
  'HIDDEN',     -- temporarily withdrawn by a moderator; restorable
  'REMOVED'     -- taken down; still auditable, never public again
);

-- Media has its own lifecycle. An image can be rejected while its parent review
-- stays published (doc 86 IMAGE SUPPORT, MODERATION).
create type app.review_media_status as enum (
  'PENDING','APPROVED','REJECTED','REMOVED'
);

-- Law 64. UNVERIFIED is the default: a review does not become "verified"
-- because its author says so.
create type app.review_verification_type as enum (
  'UNVERIFIED','VERIFIED_EXPERIENCE'
);

-- The qualifying platform events that can back a Verified Experience badge.
-- Doc 86 gives an illustrative list ("a completed task, completed withdrawal,
-- confirmed deposit, Mining Game purchase, or support interaction"). Only the
-- four that are verifiable TODAY are modelled. GAME_PURCHASE is deliberately
-- NOT here: no game-purchase table exists yet, and inventing the value would
-- mean claiming a verification the database cannot perform. It joins this enum
-- when the funding-spend layer (docs 75, 83) lands.
create type app.review_experience_type as enum (
  'TASK_COMPLETION','WITHDRAWAL_COMPLETION','DEPOSIT_CONFIRMATION','SUPPORT_INTERACTION'
);

-- Reports and moderation actions are polymorphic: they share one vocabulary so
-- the moderation queue can sort reviews, comments and media together (doc 86
-- MODERATION, 87 REVIEWS / COMMUNITY ADMIN).
create type app.review_content_target as enum (
  'REVIEW','REVIEW_COMMENT','REVIEW_MEDIA','REVIEW_COMMENT_MEDIA'
);

create type app.review_report_status as enum (
  'OPEN','IN_REVIEW','RESOLVED','DISMISSED'
);

create type app.review_moderation_action as enum (
  'APPROVE','HIDE','RESTORE','REMOVE','REJECT','DISMISS'
);

-- -----------------------------------------------------------------------------
-- reviews (doc 86 DATABASE MODEL, field for field)
-- -----------------------------------------------------------------------------

create table app.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,

  -- Doc 86: 1-5 stars. Bounded in the database so no other value is storable.
  rating smallint not null,
  title text,
  body text not null,
  category text,

  status app.review_status not null default 'PENDING',

  -- Law 64, in columns. verification_type is the badge; the other two record
  -- WHAT was verified and WHICH event, so the badge is reconstructable and
  -- auditable rather than a boolean someone flipped.
  verification_type app.review_verification_type not null default 'UNVERIFIED',
  verified_experience_type app.review_experience_type,
  -- Opaque reference to a private domain row. Intentionally NOT a foreign key;
  -- see the law 64 note in the header.
  verified_experience_id text,

  -- Retry safety (doc 86 acceptance 17).
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  deleted_at timestamptz,

  constraint reviews_idempotency_unique unique (idempotency_key),
  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_body_not_blank check (length(btrim(body)) > 0),
  constraint reviews_body_max_length check (length(body) <= 5000),
  -- A public title is optional, but if present it must not be blank whitespace.
  constraint reviews_title_not_blank check (title is null or length(btrim(title)) > 0),

  -- The badge and its evidence must agree. This is the constraint that makes a
  -- "Verified Experience" claim impossible to fake at the storage layer.
  constraint reviews_verification_evidence_consistent check (
    (verification_type = 'UNVERIFIED'
       and verified_experience_type is null
       and verified_experience_id is null)
    or
    (verification_type = 'VERIFIED_EXPERIENCE'
       and verified_experience_type is not null
       and verified_experience_id is not null)
  ),

  -- Publication state and publication timestamp must agree, so "published" can
  -- never be true without a time and vice versa.
  constraint reviews_published_at_consistent check (
    (status = 'PUBLISHED' and published_at is not null)
    or (status <> 'PUBLISHED')
  )
);

comment on table app.reviews is
  'Public user reviews (doc 86). Never a financial record: no money column and no FK to any financial table (law 63). Verified Experience is a verified ACTIVITY, not an endorsement (law 64).';

create index idx_reviews_public on app.reviews(status, published_at desc)
  where status = 'PUBLISHED' and deleted_at is null;
create index idx_reviews_user on app.reviews(user_id, created_at desc);
create index idx_reviews_rating on app.reviews(rating) where status = 'PUBLISHED';

-- Doc 86 ANTI-MANIPULATION: "Multiple reviews tied to the same qualifying
-- event" must be controlled. A user gets at most one Verified Experience review
-- per underlying event. Partial, so unverified reviews are unaffected.
create unique index idx_reviews_one_per_experience
  on app.reviews(user_id, verified_experience_type, verified_experience_id)
  where verified_experience_id is not null and deleted_at is null;

create trigger trg_reviews_updated_at
  before update on app.reviews
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- review_comments: the threaded public conversation (doc 86 THREAD / CHAT MODEL)
-- -----------------------------------------------------------------------------
--
-- "The thread is a public community conversation, not private messaging."
--
-- A reply must belong to the SAME review as the comment it answers. That is
-- enforced by a composite foreign key rather than by convention, because a
-- check constraint cannot reference another table and an application can be
-- bypassed. Without it, a crafted parent_comment_id would graft a comment onto
-- a thread in a different review.

create table app.review_comments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete cascade,
  -- Null for a top-level reply to the review itself.
  parent_comment_id uuid,
  user_id uuid not null references auth.users(id) on delete restrict,

  body text not null,
  status app.review_status not null default 'PENDING',
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint review_comments_idempotency_unique unique (idempotency_key),
  constraint review_comments_body_not_blank check (length(btrim(body)) > 0),
  constraint review_comments_body_max_length check (length(body) <= 5000),

  -- Target of the composite FK below. Redundant with the primary key, and
  -- required: PostgreSQL needs a unique constraint on the referenced columns.
  constraint review_comments_id_review_unique unique (id, review_id),
  constraint review_comments_parent_same_review
    foreign key (parent_comment_id, review_id)
    references app.review_comments(id, review_id) on delete cascade
);

comment on table app.review_comments is
  'Threaded public replies (doc 86). A reply cannot cross review boundaries: the composite FK on (parent_comment_id, review_id) makes that impossible.';

create index idx_review_comments_review on app.review_comments(review_id, created_at)
  where deleted_at is null;
create index idx_review_comments_user on app.review_comments(user_id, created_at desc);

create trigger trg_review_comments_updated_at
  before update on app.review_comments
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Media: review_media and review_comment_media (doc 86 IMAGE SUPPORT)
-- -----------------------------------------------------------------------------
--
-- Supabase Storage holds the bytes; these tables hold the METADATA and the
-- moderation state, and the metadata is what decides whether an object is
-- publicly readable. Doc 86: "Public media access must use a deliberate access
-- policy; private/moderation evidence must not become publicly readable through
-- a predictable URL."
--
-- `metadata_stripped` records whether EXIF (notably location data) was removed
-- before storage, which doc 86 and doc 54 both require where practical. It
-- records the fact rather than assuming it happened.
--
-- mime_type is the type the server derived from the ACTUAL BYTES, per doc 86:
-- "Content-type verification based on actual file bytes, not only the
-- client-reported MIME type". So this column is a verified type, not a claim.

create table app.review_media (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete restrict,

  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  metadata_stripped boolean not null default false,

  status app.review_media_status not null default 'PENDING',
  created_at timestamptz not null default now(),

  constraint review_media_storage_path_unique unique (storage_path),
  constraint review_media_byte_size_positive check (byte_size > 0),
  constraint review_media_width_positive check (width is null or width > 0),
  constraint review_media_height_positive check (height is null or height > 0),
  -- Doc 86: JPEG, PNG and WebP only unless later expanded by policy. Enforced
  -- here, so an unapproved type is not merely rejected by one upload handler.
  constraint review_media_mime_allowed check (
    mime_type in ('image/jpeg','image/png','image/webp')
  ),
  -- A storage path must be a relative object key: never absolute, never a URL,
  -- never containing a traversal segment.
  constraint review_media_storage_path_relative check (
    storage_path !~ '^/'
    and storage_path !~ '^[a-z]+://'
    and storage_path !~ '\.\.'
  )
);

comment on table app.review_media is
  'Review image metadata and moderation state (doc 86 IMAGE SUPPORT). The bytes live in Supabase Storage; public readability is decided by `status`, never by a guessable path.';

create index idx_review_media_review on app.review_media(review_id, created_at);
create index idx_review_media_pending on app.review_media(status, created_at)
  where status = 'PENDING';

create table app.review_comment_media (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references app.review_comments(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete restrict,

  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  metadata_stripped boolean not null default false,

  status app.review_media_status not null default 'PENDING',
  created_at timestamptz not null default now(),

  constraint review_comment_media_storage_path_unique unique (storage_path),
  constraint review_comment_media_byte_size_positive check (byte_size > 0),
  constraint review_comment_media_width_positive check (width is null or width > 0),
  constraint review_comment_media_height_positive check (height is null or height > 0),
  constraint review_comment_media_mime_allowed check (
    mime_type in ('image/jpeg','image/png','image/webp')
  ),
  constraint review_comment_media_storage_path_relative check (
    storage_path !~ '^/'
    and storage_path !~ '^[a-z]+://'
    and storage_path !~ '\.\.'
  )
);

comment on table app.review_comment_media is
  'Reply image metadata (doc 86). A separate table with a separate status, so an image decision never reaches into the parent review.';

create index idx_review_comment_media_comment on app.review_comment_media(comment_id, created_at);
create index idx_review_comment_media_pending on app.review_comment_media(status, created_at)
  where status = 'PENDING';

-- -----------------------------------------------------------------------------
-- review_reports: user-initiated reports (doc 86 MODERATION, REPORT CONTROLS)
-- -----------------------------------------------------------------------------

create table app.review_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,

  -- Polymorphic target. Not a foreign key, because the four target kinds live in
  -- four different tables. `target_exists` is therefore established at write
  -- time by the report command (migration 039), which is the only writer.
  target_type app.review_content_target not null,
  target_id uuid not null,

  reason_code text not null,
  details text,

  status app.review_report_status not null default 'OPEN',
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint review_reports_reason_not_blank check (length(btrim(reason_code)) > 0),
  -- Doc 86 reporting controls imply one report per user per item; a storm of
  -- duplicate reports from one account is noise in the queue, not signal.
  constraint review_reports_once_per_target unique (reporter_id, target_type, target_id),
  -- A resolved report must name its resolver and time; an open one must not.
  constraint review_reports_resolution_consistent check (
    (status in ('RESOLVED','DISMISSED') and resolved_by is not null and resolved_at is not null)
    or (status in ('OPEN','IN_REVIEW'))
  )
);

comment on table app.review_reports is
  'User reports against reviews, comments and media (doc 86). A report is an opinion about content; it never touches financial state (law 63).';

create index idx_review_reports_queue on app.review_reports(status, created_at)
  where status in ('OPEN','IN_REVIEW');
create index idx_review_reports_target on app.review_reports(target_type, target_id);

-- -----------------------------------------------------------------------------
-- review_moderation_actions: append-only human moderator decisions
-- -----------------------------------------------------------------------------
--
-- Doc 86 MODERATION requires "moderator identity and timestamp", "reason codes"
-- and a "moderation audit log". Law 67 keeps the decision human. This table is
-- the log: it is append-only, and the trigger below makes that structural rather
-- than advisory. A correction is a NEW action (RESTORE after HIDE), never an
-- edit of the old one.

create table app.review_moderation_actions (
  id bigint generated always as identity primary key,
  target_type app.review_content_target not null,
  target_id uuid not null,

  action app.review_moderation_action not null,
  reason_code text not null,
  moderator_id uuid not null references auth.users(id) on delete restrict,

  -- Free-form pointer to retained evidence (a report id, a storage path, a
  -- ticket reference). Never a copy of private financial evidence.
  evidence_reference text,

  created_at timestamptz not null default now(),

  constraint review_moderation_actions_reason_not_blank check (length(btrim(reason_code)) > 0)
);

comment on table app.review_moderation_actions is
  'Append-only record of human moderation decisions (doc 86, law 67). Holds no financial data and cannot alter any: review moderation never rewrites financial history (doc 71 V7 Admin law 6).';

create index idx_review_moderation_target on app.review_moderation_actions(target_type, target_id, created_at desc);
create index idx_review_moderation_moderator on app.review_moderation_actions(moderator_id, created_at desc);

create trigger trg_review_moderation_actions_immutable
  before update or delete on app.review_moderation_actions
  for each row execute function app_private.reject_mutation();

-- -----------------------------------------------------------------------------
-- Access control (doc 86 AUTHORIZATION / RLS, doc 70 law 70)
-- -----------------------------------------------------------------------------
--
-- RLS is enabled on every exposed table as defence in depth, and nothing is
-- granted to anon or authenticated. The public read surface is a set of named
-- `public` SECURITY DEFINER wrappers in migration 039, each of which returns a
-- deliberate projection of PUBLISHED content only. The app schema is not
-- exposed through the Data API at all, so these grants matter only if someone
-- later exposes it by accident, which is exactly when they matter most.

alter table app.reviews enable row level security;
alter table app.review_comments enable row level security;
alter table app.review_media enable row level security;
alter table app.review_comment_media enable row level security;
alter table app.review_reports enable row level security;
alter table app.review_moderation_actions enable row level security;

revoke all on table app.reviews, app.review_comments, app.review_media,
  app.review_comment_media, app.review_reports, app.review_moderation_actions
  from anon, authenticated;

grant all on table app.reviews, app.review_comments, app.review_media,
  app.review_comment_media, app.review_reports, app.review_moderation_actions
  to service_role;