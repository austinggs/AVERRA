-- =============================================================================
-- Averra migration 009: Reward engine
--
-- Source of truth: 35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt,
--                  12_TASK_SYSTEM.txt, 13_OFFERWALL_SYSTEM.txt,
--                  14_SURVEY_SYSTEM.txt, 39_REFERRAL_SYSTEM.txt,
--                  30_MINING_GAME_REWARDS.txt, 48_DATABASE_SCHEMA.txt,
--                  71_ARCHITECTURAL_LAWS.md, docs/adr/0001-financial-authority.md
--
-- The Reward Engine is the ONLY domain permitted to transform a verified earning
-- event into a financial reward obligation (doc 35 PURPOSE).
--
-- Enforced here:
--  * law 10 - every reward has a traceable funding source
--  * law 16 - a reward claim matches configured economics
--  * law 6  - a reward may be pending before it becomes withdrawable
--  * law 7  - a reversal is a compensating event, never an edit
--  * law 1  - no unbacked balance; a budget is decremented atomically
--  * law 36 - the engine never reads a client-submitted amount as truth
-- =============================================================================

-- The funding source. A reward without one of these rows cannot exist.
create table app.reward_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  -- 'PROVIDER' economics, 'ADVERTISER' campaign budget, or an explicitly
  -- configured Averra-funded promotional budget (doc 05 REWARD SOURCE).
  name text not null,
  currency_unit text not null default 'NGN',
  -- Amount still available to fund rewards. Decremented atomically on award.
  budget_remaining_minor bigint not null default 0,
  budget_total_minor bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_sources_type_check check (
    source_type in ('PROVIDER','ADVERTISER','AVERRA_PROMOTIONAL')
  ),
  constraint reward_sources_budget_non_negative check (budget_remaining_minor >= 0),
  constraint reward_sources_budget_total_check check (budget_total_minor >= 0),
  constraint reward_sources_remaining_within_total check (budget_remaining_minor <= budget_total_minor)
);

create trigger trg_reward_sources_updated_at
  before update on app.reward_sources
  for each row execute function app_private.set_updated_at();

comment on table app.reward_sources is 'Traceable funding source for every reward. law 10: no reward without one of these.';


-- One reward obligation. Created by the engine from a verified business event.
create table app.rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  source_id uuid not null references app.reward_sources(id) on delete restrict,
  state app.reward_state not null default 'PENDING',

  amount_minor bigint not null,
  unit text not null,

  -- Provenance: which business event produced this reward.
  event_type text not null,
  source_event_id text not null,
  -- The gross value the rule was applied to, retained for audit (doc 05 INPUTS).
  gross_value_minor bigint,
  rule_reference text,

  idempotency_key text not null,
  correlation_id uuid,

  -- A reversal points at the reward it compensates.
  reverses_reward_id uuid references app.rewards(id) on delete restrict,

  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint rewards_amount_positive check (amount_minor > 0),
  -- law 5: the same source event can never produce two rewards.
  constraint rewards_idempotency_unique unique (idempotency_key),
  constraint rewards_not_self_reversal check (reverses_reward_id is null or reverses_reward_id <> id)
);

create index idx_rewards_user on app.rewards(user_id, created_at desc);
create index idx_rewards_source on app.rewards(source_id);
create index idx_rewards_state on app.rewards(state, created_at);
-- One reward per source event. This is the duplicate-callback guarantee.
create unique index uq_rewards_source_event on app.rewards(event_type, source_event_id);

comment on table app.rewards is 'A reward obligation. Every row traces to a reward_sources row and a verified business event.';

-- Immutable state history. Append-only, like the ledger.
create table app.reward_state_transitions (
  id bigint generated always as identity primary key,
  reward_id uuid not null references app.rewards(id) on delete cascade,
  from_state app.reward_state,
  to_state app.reward_state not null,
  reason_code text,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_reward_state_transitions_reward on app.reward_state_transitions(reward_id, id);

create trigger trg_reward_state_transitions_immutable
  before update or delete on app.reward_state_transitions
  for each row execute function app_private.reject_mutation();

-- Caps. Per-user, per-day and per-event ceilings (doc 30 CAPS).
create table app.reward_caps (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  scope_reference text,
  cap_type text not null,
  cap_amount_minor bigint not null,
  window_start timestamptz,
  window_end timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint reward_caps_scope_check check (scope in ('USER','GLOBAL','SOURCE','EVENT')),
  constraint reward_caps_type_check check (cap_type in ('PER_USER_TOTAL','PER_DAY','PER_EVENT')),
  constraint reward_caps_amount_positive check (cap_amount_minor > 0),
  constraint reward_caps_window_check check (
    window_end is null or window_start is null or window_end > window_start
  )
);

create index idx_reward_caps_active on app.reward_caps(scope, scope_reference)
  where is_active;

alter table app.reward_sources enable row level security;
alter table app.rewards enable row level security;
alter table app.reward_state_transitions enable row level security;
alter table app.reward_caps enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
