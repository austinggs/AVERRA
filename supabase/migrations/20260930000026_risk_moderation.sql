-- =============================================================================
-- Averra migration 026: Fraud risk decisions and content moderation
--
-- Source of truth: 40_FRAUD_ANTI_ABUSE.txt, 58_CONTENT_MODERATION.txt,
--                  71_ARCHITECTURAL_LAWS.md law 41, law 42, law 43
--
-- TWO DISTINCT DECISION SYSTEMS, DELIBERATELY
--
-- Doc 58 SAFETY BOUNDARY: "Fraud/risk enforcement and content moderation are
-- related but distinct decision systems." So these are separate tables with
-- separate states, separate reasons and separate reviewers. A content takedown
-- and a fraud hold are different judgements about different things, and
-- conflating them would let one system's decision silently become the other's.
--
-- DOC 40 FINANCIAL INTEGRITY, THE LOAD-BEARING CONSTRAINT
--
-- "Risk decisions may hold or reject future events but must not silently rewrite
-- financial history."
--
-- That is enforced structurally. A risk decision references the evidence it was
-- based on; it NEVER writes to the ledger and never mutates an existing reward,
-- deposit, withdrawal or balance. There is no column on either table that can
-- alter a financial amount. The only permitted financial consequence is a
-- forward-looking HOLD: a gate on a future decision, not a correction of a past
-- one.
--
-- Doc 40 DECISION MODEL, with reason codes and evidence, is the vocabulary
-- below. Every decision REQUIRES a reason code, so "we blocked this user" is
-- never an unexplained outcome.
-- =============================================================================

create type app.risk_decision as enum (
  'ALLOW','HOLD','REVIEW','REJECT','RESTRICT','SUSPEND','TERMINATE'
);

create type app.risk_subject as enum (
  'USER','DEVICE','PROVIDER','CAMPAIGN','PAYMENT_DESTINATION','SESSION'
);

create type app.moderation_status as enum (
  'PENDING','APPROVED','REJECTED','ESCALATED','BLOCKED'
);

-- Doc 40 RISK SIGNALS, retained under the privacy rules of doc 54.
--
-- Signals are OBSERVATIONS, not verdicts. Nothing here changes a balance.
create table app.risk_signals (
  id bigint generated always as identity primary key,
  subject_type app.risk_subject not null,
  -- The user this signal concerns, when the subject is a user. Nullable because
  -- a device or session signal may precede any known user.
  subject_user_id uuid references auth.users(id) on delete cascade,
  -- A stable HASH of a device or network identifier. Raw identifiers are NOT
  -- stored: doc 54 requires data minimisation, and a raw device id is personal
  -- data that serves no purpose once hashed for correlation.
  subject_hash text,
  signal_type text not null,
  -- A bounded score, not a probability of guilt.
  score integer not null default 0,
  -- Evidence retained for review. Never surfaced to the end user (doc 54).
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint risk_signals_score_bounded check (score between 0 and 100),
  constraint risk_signals_type_not_blank check (length(trim(signal_type)) > 0)
);

create index idx_risk_signals_user on app.risk_signals(subject_user_id, created_at desc);
create index idx_risk_signals_hash on app.risk_signals(subject_hash, created_at desc);

create trigger trg_risk_signals_immutable
  before update or delete on app.risk_signals
  for each row execute function app_private.reject_mutation();

-- Doc 40 DECISION MODEL. Append-only: a decision is evidence, never mutable state.
create table app.risk_decisions (
  id bigint generated always as identity primary key,
  subject_type app.risk_subject not null,
  subject_user_id uuid references auth.users(id) on delete cascade,
  decision app.risk_decision not null,
  -- Doc 40: "with reason codes and evidence". A decision without a reason is
  -- refused, so no enforcement action is ever unexplained.
  reason_code text not null,
  notes text,
  evidence jsonb not null default '{}'::jsonb,
  -- The signals this decision was based on. Not required (an operator may act
  -- on judgement alone) but recorded when present.
  signal_ids bigint[] not null default '{}',
  decided_by uuid references auth.users(id),
  -- Doc 40 APPEALS: resolution is a NEW row, not an update, so the original
  -- stands as history.
  superseded_by_id bigint references app.risk_decisions(id) on delete restrict,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint risk_decisions_reason_not_blank check (length(trim(reason_code)) > 0),
  -- A termination is a deliberate act and must never expire silently.
  constraint risk_decisions_terminate_persistent check (
    decision <> 'TERMINATE' or expires_at is null
  )
);

create index idx_risk_decisions_user on app.risk_decisions(subject_user_id, created_at desc);

create trigger trg_risk_decisions_immutable
  before update or delete on app.risk_decisions
  for each row execute function app_private.reject_mutation();

-- ---------------------------------------------------------------------------
-- DOC 58 CONTENT MODERATION. A SEPARATE decision system (SAFETY BOUNDARY).
-- ---------------------------------------------------------------------------
create type app.moderation_target as enum (
  'PROFILE','SUPPORT_CONTENT','ADVERTISER_CREATIVE','TASK_DESCRIPTION',
  'GAME_CONTENT','COMMUNITY_POST'
);

create table app.moderation_items (
  id uuid primary key default gen_random_uuid(),
  target_type app.moderation_target not null,
  -- Content is STORED, not copied by reference, so the reviewed text IS the
  -- evidence. Doc 58 EVIDENCE.
  content text not null,
  author_user_id uuid references auth.users(id) on delete set null,
  status app.moderation_status not null default 'PENDING',
  -- Doc 58: reason codes are retained for every action.
  reason_code text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_items_content_not_blank check (length(trim(content)) > 0),
  -- A review outcome must carry a reason code and a reviewer.
  constraint moderation_items_reviewed_needs_reason check (
    status = 'PENDING' or reason_code is not null
  ),
  constraint moderation_items_reviewed_needs_reviewer check (
    status = 'PENDING' or reviewed_by is not null
  )
);

create index idx_moderation_items_status on app.moderation_items(status, created_at desc);

create trigger trg_moderation_items_updated_at
  before update on app.moderation_items
  for each row execute function app_private.set_updated_at();

comment on table app.risk_decisions is
  'Doc 40. Append-only. A risk decision may hold or reject a FUTURE event; it can never rewrite financial history, and this table has no column that could.';
comment on table app.moderation_items is
  'Doc 58. Distinct from fraud/risk decisions (SAFETY BOUNDARY). Every review outcome retains a reason code and a reviewer.';

alter table app.risk_signals enable row level security;
alter table app.risk_decisions enable row level security;
alter table app.moderation_items enable row level security;

revoke all on table app.risk_signals, app.risk_decisions, app.moderation_items from anon, authenticated;
revoke all on sequence app.risk_signals_id_seq, app.risk_decisions_id_seq from anon, authenticated;
grant all on table app.risk_signals, app.risk_decisions, app.moderation_items to service_role;
grant all on sequence app.risk_signals_id_seq, app.risk_decisions_id_seq to service_role;