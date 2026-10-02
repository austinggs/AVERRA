-- =============================================================================
-- Averra migration 014: Provider ecosystem registry
--
-- Source of truth: 06_PROVIDER_ECOSYSTEM.txt, 07_PROVIDER_ELIGIBILITY_MATRIX.txt,
--                  08_PROVIDER_INTEGRATION.txt, 13_OFFERWALL_SYSTEM.txt,
--                  14_SURVEY_SYSTEM.txt, 48_DATABASE_SCHEMA.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 4/5/12/25
--
-- Enforced here:
--  * law 4  - callbacks are authenticated and validated
--  * law 5  - callbacks are idempotent
--  * law 12 - integrations are replaceable; vendors are configuration, not code
--  * doc 07 - a provider cannot be LIVE without the recorded decision gates
--  * doc 06 - providers are modelled by CAPABILITY, never by vendor name
--
-- NO LIVE PROVIDER IS SEEDED. Doc 07 requires integration tests, callback
-- authenticity validation, duplicate/replay tests, economic validation and
-- business/compliance approval before a provider may be live. None of that has
-- been performed for any vendor, so every row below seeds as a CANDIDATE with no
-- approval timestamps. Doc 78 forbids inventing provider behaviour.
-- =============================================================================

create type app.provider_class as enum (
  'SURVEY','OFFERWALL','CPA','TASK','REWARDED_CONTENT','ADVERTISING','RESEARCH'
);

-- Doc 06 LIFECYCLE. REJECTED is terminal and is not a live state.
create type app.provider_state as enum (
  'CANDIDATE','APPLIED','APPROVED','INTEGRATION_TESTING',
  'LIVE','SUSPENDED','RETIRED','REJECTED'
);

create type app.provider_source_type as enum (
  'OFFER','SURVEY','TASK','REFERRAL','GAME','ADVERTISER_CAMPAIGN'
);

create type app.conversion_status as enum (
  'RECEIVED','VALIDATED','REJECTED','CONVERTED','REVERSED','CHARGEBACK'
);

create type app.callback_verification_result as enum (
  'VERIFIED','FAILED','ABSENT','UNSUPPORTED'
);

-- The provider registry. A row is configuration, not logic: swapping a vendor
-- must never require a code change (law 12).
create table app.providers (
  id uuid primary key default gen_random_uuid(),
  -- Stable slug used in callback URLs. Never the vendor's own id.
  code text not null,
  display_name text not null,
  provider_class app.provider_class not null,
  lifecycle_state app.provider_state not null default 'CANDIDATE',

  -- Named signature scheme. The scheme is configured, never hard-coded per
  -- vendor, and no secret lives in this table.
  signature_scheme text,
  supports_postback boolean not null default false,
  supports_webhook boolean not null default false,

  settlement_currency text,
  payout_rail text,

  -- Doc 07 REQUIRED COLUMNS, as verifiable configuration rather than prose.
  nigeria_available boolean,
  incentive_policy_verified_at timestamptz,
  commercial_approved_at timestamptz,
  compliance_approved_at timestamptz,
  integration_tested_at timestamptz,
  callback_authenticity_tested_at timestamptz,
  duplicate_replay_tested_at timestamptz,
  economic_validated_at timestamptz,
  integration_owner text,
  last_verified_at timestamptz,
  -- Doc 07 DYNAMIC NATURE: entries expire and must be revalidated.
  verification_expires_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint providers_code_unique unique (code),
  constraint providers_code_shape check (code ~ '^[a-z0-9_]{2,64}$'),

  -- DOC 07 DECISION GATES, enforced structurally.
  --
  -- A provider cannot be LIVE without ALL of: technical integration tests,
  -- callback authenticity validation, duplicate/replay tests, economic
  -- validation, commercial approval and compliance review. This turns an
  -- operational checklist into a database invariant, so a row cannot be flipped
  -- to LIVE by a single UPDATE that forgets one of them.
  constraint providers_live_requires_all_gates check (
    lifecycle_state <> 'LIVE' or (
      integration_tested_at is not null
      and callback_authenticity_tested_at is not null
      and duplicate_replay_tested_at is not null
      and economic_validated_at is not null
      and commercial_approved_at is not null
      and compliance_approved_at is not null
      and last_verified_at is not null
    )
  ),

  -- Doc 07 DYNAMIC NATURE: a live provider must carry an expiry so staleness is
  -- representable rather than forgotten.
  constraint providers_live_requires_expiry check (
    lifecycle_state <> 'LIVE' or verification_expires_at is not null
  ),

  -- Verification must expire after it was granted, never before.
  constraint providers_expiry_after_verification check (
    verification_expires_at is null
    or last_verified_at is null
    or verification_expires_at > last_verified_at
  )
);

create trigger trg_providers_updated_at
  before update on app.providers
  for each row execute function app_private.set_updated_at();

create index idx_providers_live on app.providers(lifecycle_state)
  where lifecycle_state = 'LIVE';
create index idx_providers_expiring on app.providers(verification_expires_at)
  where lifecycle_state = 'LIVE' and verification_expires_at is not null;

comment on table app.providers is 'Provider registry. A LIVE row requires every doc 07 decision gate to be recorded.';

-- Capabilities, not vendor names (doc 06 PROVIDER CLASSES).
create table app.provider_capabilities (
  provider_id uuid not null references app.providers(id) on delete cascade,
  capability_code text not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (provider_id, capability_code)
);

comment on table app.provider_capabilities is 'What a provider can do (offerwall, survey, cpa, ...). Business logic reads capabilities, never vendor names.';
-- Raw callback evidence. Append-only.
--
-- The payload is recorded BEFORE any processing, so evidence survives a failed
-- signature check, a malformed body, or a provider outage (doc 08 CALLBACK
-- REQUIREMENTS: "record raw evidence"). The processing outcome lives in a
-- separate table so this row never has to be updated.
create table app.provider_callbacks (
  id bigint generated always as identity primary key,
  provider_id uuid not null references app.providers(id) on delete restrict,
  received_at timestamptz not null default now(),

  -- Origin evidence.
  remote_address inet,
  signature_present boolean not null default false,
  signature_algorithm text,
  verification_result app.callback_verification_result not null default 'ABSENT',
  verification_reason text,

  -- What the provider claimed, before we believe any of it.
  claimed_event_id text,
  claimed_event_timestamp timestamptz,

  -- Raw body and its hash. Never parsed destructively, never truncated.
  raw_payload jsonb not null,
  payload_hash text not null,
  headers jsonb not null default '{}'::jsonb,

  correlation_id uuid
);

create index idx_provider_callbacks_provider on app.provider_callbacks(provider_id, received_at desc);
create index idx_provider_callbacks_unverified on app.provider_callbacks(received_at)
  where verification_result <> 'VERIFIED';

create trigger trg_provider_callbacks_immutable
  before update or delete on app.provider_callbacks
  for each row execute function app_private.reject_mutation();

comment on table app.provider_callbacks is 'Raw, append-only provider callback evidence. Written before processing so a failure cannot erase the trail.';

-- The outcome of processing a callback, kept separate so the raw row stays
-- immutable. One row per callback.
create table app.provider_callback_results (
  callback_id bigint primary key references app.provider_callbacks(id) on delete cascade,
  processing_result text not null,
  reason_code text,
  conversion_id uuid,
  correlation_id uuid,
  processed_at timestamptz not null default now(),
  constraint provider_callback_results_result_check check (
    processing_result in ('ACCEPTED','REJECTED','DUPLICATE','IGNORED','PENDING')
  )
);

create trigger trg_provider_callback_results_immutable
  before update or delete on app.provider_callback_results
  for each row execute function app_private.reject_mutation();

-- A verified business event. This is what the Reward Engine consumes; it is NOT
-- a ledger entry (doc 08 FINANCIAL BOUNDARY).
create table app.provider_conversions (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references app.providers(id) on delete restrict,
  callback_id bigint references app.provider_callbacks(id) on delete set null,

  -- LAW 5: the same provider event can never produce two conversions, and
  -- therefore never two rewards. This index is the guarantee.
  provider_event_id text not null,

  source_type app.provider_source_type not null,
  campaign_ref text,
  user_id uuid references auth.users(id) on delete restrict,
  tracking_id text,

  event_type text not null,
  status app.conversion_status not null default 'RECEIVED',

  gross_value_minor bigint,
  currency text,
  event_timestamp timestamptz,

  -- Doc 08 NORMALIZED EVENT.
  normalized_payload jsonb not null default '{}'::jsonb,
  -- How the raw value became a reward, for later reconciliation.
  reward_rule_reference text,
  reward_id uuid references app.rewards(id) on delete set null,

  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint provider_conversions_gross_non_negative check (
    gross_value_minor is null or gross_value_minor >= 0
  ),
  constraint provider_conversions_reward_only_when_converted check (
    reward_id is null or status = 'CONVERTED'
  )
);

create unique index uq_provider_conversions_event
  on app.provider_conversions(provider_id, provider_event_id);

create index idx_provider_conversions_user on app.provider_conversions(user_id, created_at desc);
create index idx_provider_conversions_status on app.provider_conversions(status, created_at);
create index idx_provider_conversions_callback on app.provider_conversions(callback_id);

create trigger trg_provider_conversions_updated_at
  before update on app.provider_conversions
  for each row execute function app_private.set_updated_at();

comment on table app.provider_conversions is 'A verified provider business event. Consumes reward creation; never writes the ledger directly.';
-- Provider settlement reports, reconciled against local conversions.
create table app.provider_settlements (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references app.providers(id) on delete restrict,
  provider_reference text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  currency text not null,
  reported_amount_minor bigint not null,
  reported_conversion_count integer not null,
  -- What our own records said for the same period. Computed, not trusted.
  expected_amount_minor bigint,
  expected_conversion_count integer,
  variance_minor bigint,
  status app.reconciliation_status not null default 'PENDING',
  variance_reason text,
  reconciled_by uuid references auth.users(id),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint provider_settlements_reference_unique unique (provider_id, provider_reference),
  constraint provider_settlements_period_check check (period_end > period_start),
  constraint provider_settlements_reported_non_negative check (reported_amount_minor >= 0),
  constraint provider_settlements_count_non_negative check (reported_conversion_count >= 0)
);

create index idx_provider_settlements_open on app.provider_settlements(provider_id, period_start desc)
  where status in ('PENDING','VARIANCE');

-- Discovered inventory. Content is provider-owned and refreshed by the adapter;
-- the user-facing offer definition references it.
create table app.offers (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references app.providers(id) on delete cascade,
  external_offer_id text not null,
  title text not null,
  description text,
  category text,
  countries text[] not null default '{}',
  devices text[] not null default '{}',
  -- Display only. Doc 13 PRESENTATION forbids overstating certainty.
  displayed_payout_minor bigint,
  displayed_payout_currency text,
  conditions text,
  tracking_base_url text,
  is_active boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  constraint offers_external_unique unique (provider_id, external_offer_id),
  constraint offers_payout_non_negative check (
    displayed_payout_minor is null or displayed_payout_minor >= 0
  )
);

create index idx_offers_active on app.offers(is_active, category);

-- Surveys (doc 14). Qualification is NOT completion and is tracked separately on
-- the participant record, not here.
create table app.surveys (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references app.providers(id) on delete cascade,
  external_survey_id text not null,
  title text not null,
  description text,
  categories text[] not null default '{}',
  languages text[] not null default '{}',
  countries text[] not null default '{}',
  estimated_duration_seconds integer,
  base_reward_minor bigint,
  reward_currency text,
  is_active boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  constraint surveys_external_unique unique (provider_id, external_survey_id),
  constraint surveys_duration_positive check (
    estimated_duration_seconds is null or estimated_duration_seconds > 0
  ),
  constraint surveys_reward_non_negative check (
    base_reward_minor is null or base_reward_minor >= 0
  )
);

create index idx_surveys_active on app.surveys(is_active);

-- A user's interaction with a discovered offer or survey. Qualification, start
-- and finish are tracked here; reward state is NOT, because reward state belongs
-- to app.rewards (doc 14 TRACKING).
create table app.provider_participations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider_id uuid not null references app.providers(id) on delete restrict,
  offer_id uuid references app.offers(id) on delete set null,
  survey_id uuid references app.surveys(id) on delete set null,
  -- Immutable attribution identifier (doc 13 TRACKING).
  tracking_id text not null,
  status text not null default 'STARTED',
  qualification_status text,
  qualification_reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_seconds integer,
  conversion_id uuid references app.provider_conversions(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint provider_participations_tracking_unique unique (provider_id, tracking_id),
  constraint provider_participations_status_check check (
    status in ('STARTED','QUALIFYING','QUALIFIED','INELIGIBLE','COMPLETED','VERIFIED','FAILED')
  ),
  constraint provider_participations_has_subject check (
    offer_id is not null or survey_id is not null
  )
);

create index idx_provider_participations_user on app.provider_participations(user_id, created_at desc);
create index idx_provider_participations_status on app.provider_participations(status, created_at)
  where status not in ('VERIFIED','FAILED');

alter table app.providers enable row level security;
alter table app.provider_capabilities enable row level security;
alter table app.provider_callbacks enable row level security;
alter table app.provider_callback_results enable row level security;
alter table app.provider_conversions enable row level security;
alter table app.provider_settlements enable row level security;
alter table app.offers enable row level security;
alter table app.surveys enable row level security;
alter table app.provider_participations enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;

-- The candidate providers from doc 06, seeded as CANDIDATES ONLY.
--
-- Seeding a name here is not an endorsement and not an integration. Every row is
-- CANDIDATE, is_active is false, and every doc 07 gate timestamp is null, so the
-- providers_live_requires_all_gates constraint makes it impossible to treat any
-- of these as approved without recording the evidence.
insert into app.providers (code, display_name, provider_class, lifecycle_state) values
  ('cpx_research',    'CPX Research',     'SURVEY',     'CANDIDATE'),
  ('bitlabs',         'BitLabs',          'OFFERWALL',  'CANDIDATE'),
  ('lootably',        'Lootably',         'OFFERWALL',  'CANDIDATE'),
  ('adgate_media',    'AdGate Media',     'OFFERWALL',  'CANDIDATE'),
  ('cpalead',         'CPAlead',          'CPA',        'CANDIDATE'),
  ('adswedmedia',     'AdswedMedia',      'OFFERWALL',  'CANDIDATE'),
  ('kiwiwall',        'Kiwiwall',         'OFFERWALL',  'CANDIDATE'),
  ('torox_offertoro', 'Torox/OfferToro',  'OFFERWALL',  'CANDIDATE'),
  ('revu',            'RevU',             'OFFERWALL',  'CANDIDATE'),
  ('ayet_studios',    'AyeT Studios',     'OFFERWALL',  'CANDIDATE'),
  ('theoremreach',    'TheoremReach',     'RESEARCH',   'CANDIDATE'),
  ('inbrain',         'inBrain',          'RESEARCH',   'CANDIDATE'),
  ('pollfish',        'Pollfish',         'SURVEY',     'CANDIDATE'),
  ('tapresearch',     'TapResearch',      'RESEARCH',   'CANDIDATE')
on conflict (code) do nothing;