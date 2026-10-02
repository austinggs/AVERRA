-- =============================================================================
-- Averra migration 016: Native task system
--
-- Source of truth: 12_TASK_SYSTEM.txt, 48_DATABASE_SCHEMA.txt,
--                  05_REWARD_ECONOMICS.txt, 35_REWARD_ENGINE.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 1/2/8/9/10/12/16
--
-- Doc 12 VERIFICATION, enforced as a database invariant:
--   "Each task type declares its verification mechanism. Client completion
--    claims are evidence only, never sufficient for financial credit unless a
--    server verification rule explicitly says so."
--
-- Two constraints carry that sentence:
--   * a task that pays must declare a verification mechanism, so there is no
--     unverifiable payout (law 8, no self-completion for personal gain)
--   * a SELF_ATTESTED task can never auto-verify, so a client claim cannot
--     reach the reward engine without a server-side decision (law 12)
--
-- Doc 12 FUNDING: rewards come from a campaign, advertiser, provider or an
-- approved Averra-funded budget, so a paying task names a reward_sources row.
-- =============================================================================

create type app.task_state as enum (
  'DRAFT','SCHEDULED','LIVE','PAUSED','EXPIRED','ARCHIVED'
);

-- Doc 12: each task type declares its verification mechanism.
create type app.verification_mechanism as enum (
  -- An external platform event proves it (a provider conversion, a chain event).
  'SERVER_EVENT',
  -- A deterministic server-side rule evaluates it.
  'SERVER_RULE',
  -- The user asserts it. Evidence only; requires a human or server decision.
  'SELF_ATTESTED',
  -- No verification. Such a task can never pay.
  'NONE'
);

create type app.task_attempt_status as enum (
  'STARTED','SUBMITTED','UNDER_REVIEW','VERIFIED','REJECTED','EXPIRED','ABANDONED'
);

create type app.verification_result as enum ('PASS','FAIL','REVIEW');

create table app.task_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  description text,
  instructions text,

  state app.task_state not null default 'DRAFT',
  verification_mechanism app.verification_mechanism not null,

  -- Whether a SERVER decision may verify this task without a human in the loop.
  -- The constraint below forbids this for SELF_ATTESTED, which is the whole
  -- point: a client claim must never be sufficient for financial credit.
  auto_verify boolean not null default false,

  reward_amount_minor bigint,
  reward_unit text,
  -- Doc 12 FUNDING. A paying task must name its traceable funding source.
  funding_source_id uuid references app.reward_sources(id) on delete restrict,

  -- Eligibility (doc 12 ELIGIBILITY / ABUSE CONTROLS).
  countries text[] not null default '{}',
  min_account_age_days integer not null default 0,
  max_attempts_per_user integer not null default 1,
  -- Doc 12 "impossible-time checks": a task cannot be completed faster than this.
  min_duration_seconds integer not null default 0,
  requires_profile_complete boolean not null default false,

  available_from timestamptz,
  available_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_definitions_code_unique unique (code),
  constraint task_definitions_code_shape check (code ~ '^[a-z0-9_]{2,64}$'),

  -- A reward amount, where present, is a real positive amount.
  constraint task_definitions_reward_positive check (
    reward_amount_minor is null or reward_amount_minor > 0
  ),

  -- DOC 12 VERIFICATION, part one: a task that pays must declare how it is
  -- verified. A task with mechanism NONE and a reward would be an unverifiable
  -- payout, which is exactly what law 8 forbids.
  constraint task_definitions_paying_task_needs_verification check (
    reward_amount_minor is null or verification_mechanism <> 'NONE'
  ),

  -- DOC 12 VERIFICATION, part two: a self-attested task can never auto-verify.
  -- This is the structural form of "client completion claims are evidence only".
  constraint task_definitions_self_attested_never_auto_verifies check (
    verification_mechanism <> 'SELF_ATTESTED' or auto_verify = false
  ),

  -- A paying task needs both an amount and a unit, and a funding source.
  constraint task_definitions_reward_needs_unit check (
    reward_amount_minor is null or (reward_unit is not null and length(trim(reward_unit)) > 0)
  ),
  constraint task_definitions_reward_needs_funding check (
    reward_amount_minor is null or funding_source_id is not null
  ),

  constraint task_definitions_attempts_positive check (max_attempts_per_user >= 1),
  constraint task_definitions_min_duration check (min_duration_seconds >= 0),
  constraint task_definitions_account_age check (min_account_age_days >= 0),
  constraint task_definitions_window check (
    available_until is null or available_from is null or available_until > available_from
  )
);

create trigger trg_task_definitions_updated_at
  before update on app.task_definitions
  for each row execute function app_private.set_updated_at();

create index idx_task_definitions_live on app.task_definitions(state, available_from)
  where state = 'LIVE';

comment on table app.task_definitions is 'A first-party task. A task that pays must declare a verification mechanism and a funding source.';

-- A user's run at a task. Attempts have their own lifecycle, separate from the
-- task definition's state (doc 12 TASK STATES).
create table app.task_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references app.task_definitions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,

  attempt_number integer not null,
  status app.task_attempt_status not null default 'STARTED',

  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,

  -- EVIDENCE ONLY. A client claim never credits anything by itself. Doc 12
  -- VERIFICATION; the reward is created by verify_task_completion and only
  -- after a server-side or human decision.
  client_claim jsonb not null default '{}'::jsonb,

  -- Abuse signals (doc 12 identity/device controls). Retained, never trusted.
  client_device_fingerprint text,
  client_ip inet,

  -- Server-measured duration. The impossible-time check reads THIS, not any
  -- value the client supplied, so a forged timer cannot beat the minimum.
  server_duration_seconds integer,

  review_reason text,
  rejection_reason text,
  reward_id uuid references app.rewards(id) on delete restrict,

  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_attempts_number_positive check (attempt_number >= 1),
  constraint task_attempts_duration_non_negative check (
    server_duration_seconds is null or server_duration_seconds >= 0
  ),
  -- One attempt per task per user per attempt number.
  constraint task_attempts_number_unique unique (task_id, user_id, attempt_number),
  -- An attempt carries at most one reward, and only once verified.
  constraint task_attempts_reward_only_when_verified check (
    reward_id is null or status = 'VERIFIED'
  )
);

create index idx_task_attempts_user on app.task_attempts(user_id, created_at desc);
create index idx_task_attempts_task on app.task_attempts(task_id, created_at desc);
create index idx_task_attempts_review_queue on app.task_attempts(status, submitted_at)
  where status in ('SUBMITTED','UNDER_REVIEW');

create trigger trg_task_attempts_updated_at
  before update on app.task_attempts
  for each row execute function app_private.set_updated_at();

comment on table app.task_attempts is 'A user run at a task. client_claim is evidence only and never credits a reward by itself.';
comment on column app.task_attempts.server_duration_seconds is 'Measured by the server from its own timestamps. Never taken from the client.';

-- Verification records. Append-only, so the verification history of a task
-- reconstructable and cannot be quietly rewritten.
create table app.task_verifications (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references app.task_attempts(id) on delete cascade,
  mechanism app.verification_mechanism not null,
  result app.verification_result not null,
  reason_code text,
  evidence jsonb not null default '{}'::jsonb,
  verified_by uuid references auth.users(id),
  verified_at timestamptz not null default now()
);

create index idx_task_verifications_attempt on app.task_verifications(attempt_id, id desc);

create trigger trg_task_verifications_immutable
  before update or delete on app.task_verifications
  for each row execute function app_private.reject_mutation();

comment on table app.task_verifications is 'Append-only verification history for a task attempt.';

-- Task and attempt event history (doc 12 TASK MODEL: event history).
create table app.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references app.task_definitions(id) on delete cascade,
  attempt_id uuid references app.task_attempts(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id),
  from_status app.task_attempt_status,
  to_status app.task_attempt_status,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_task_events_task on app.task_events(task_id, id);
create index idx_task_events_attempt on app.task_events(attempt_id, id) where attempt_id is not null;

create trigger trg_task_events_immutable
  before update or delete on app.task_events
  for each row execute function app_private.reject_mutation();

alter table app.task_definitions enable row level security;
alter table app.task_attempts enable row level security;
alter table app.task_verifications enable row level security;
alter table app.task_events enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
