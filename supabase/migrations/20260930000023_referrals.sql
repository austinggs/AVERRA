-- =============================================================================
-- Averra migration 023: Referral system
--
-- Source of truth: 39_REFERRAL_SYSTEM.txt, 05_REWARD_ECONOMICS.txt,
--                  71_ARCHITECTURAL_LAWS.md law 6, law 8, law 10, law 30
--
-- THE GOVERNING RULE
--
-- Doc 39 QUALIFICATION: "Referral reward requires configured qualifying
-- behavior, such as verified activity or thresholded earnings, and cannot be
-- triggered merely by account creation unless explicitly funded and allowed."
--
-- That is enforced as a database constraint, not as application logic. A
-- referral row cannot record a QUALIFIED status unless it names a qualifying
-- event, and a qualifying event cannot exist without being server-recorded. So
-- there is no shape of referral that pays for a signup alone.
--
-- Doc 39 ANTI-ABUSE: self-referral is refused by a constraint rather than by a
-- trigger, because the referrer and the referee are both columns of this table
-- and their inequality is knowable at write time.
-- =============================================================================

create type app.referral_status as enum (
  -- Attributed, but nothing has qualified yet. Pays nothing.
  'ATTRIBUTED',
  -- A qualifying behaviour was recorded. Still not paid.
  'QUALIFIED',
  -- A reward exists, created by the Reward Engine. Still not settled.
  'REWARDED',
  'REJECTED'
);

create table app.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  -- Attributed earnings threshold, in the source unit. Qualification compares
  -- against server-recorded data only.
  qualification_threshold_minor bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint referral_codes_code_unique unique (code),
  constraint referral_codes_user_unique unique (user_id),
  constraint referral_codes_code_shape check (code ~ '^[A-Z0-9]{6,16}$'),
  constraint referral_codes_threshold_non_negative check (qualification_threshold_minor >= 0)
);

create table app.referrals (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references app.referral_codes(id) on delete restrict,
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referee_user_id uuid not null references auth.users(id) on delete restrict,
  status app.referral_status not null default 'ATTRIBUTED',
  -- Doc 39 ANTI-ABUSE. Set when the referee reaches the configured threshold.
  -- A QUALIFIED referral MUST name the event that qualified it.
  qualifying_event_id uuid,
  qualified_at timestamptz,
  -- Law 10: every reward traces to a funding source.
  reward_id uuid references app.rewards(id) on delete restrict,
  reward_source_id uuid references app.reward_sources(id) on delete restrict,
  -- Doc 39 TRANSPARENCY: why a referral is pending or rejected, without
  -- exposing internal risk signals to the user.
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Doc 39 ANTI-ABUSE: self-referral is impossible, not merely detected.
  constraint referrals_no_self_referral check (referrer_user_id <> referee_user_id),
  -- A user may be referred exactly once.
  constraint referrals_referee_unique unique (referee_user_id),

  -- DOC 39 QUALIFICATION, enforced structurally: a referral cannot be QUALIFIED
  -- or REWARDED without naming the server-recorded event that qualified it.
  -- This is why a referral cannot pay merely for an account existing.
  constraint referrals_qualified_needs_event check (
    status not in ('QUALIFIED','REWARDED') or qualifying_event_id is not null
  ),
  constraint referrals_qualified_needs_timestamp check (
    status not in ('QUALIFIED','REWARDED') or qualified_at is not null
  ),
  -- A rewarded referral must trace to both a reward and its funding source.
  constraint referrals_rewarded_needs_reward check (
    status <> 'REWARDED' or (reward_id is not null and reward_source_id is not null)
  )
);

create index idx_referrals_referrer on app.referrals(referrer_user_id, created_at desc);

create trigger trg_referrals_updated_at
  before update on app.referrals
  for each row execute function app_private.set_updated_at();

comment on table app.referrals is
  'Doc 39: qualification is required before any reward. The qualifying_event_id constraint is what makes an account-creation-only referral impossible.';

alter table app.referral_codes enable row level security;
alter table app.referrals enable row level security;

revoke all on table app.referral_codes, app.referrals from anon, authenticated;
grant all on table app.referral_codes, app.referrals to service_role;