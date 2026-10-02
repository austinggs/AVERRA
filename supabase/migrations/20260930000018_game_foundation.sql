-- =============================================================================
-- Averra migration 018: Mining Game foundation
--
-- Source of truth: 15_MINING_GAME_OVERVIEW, 16_GAMEPLAY, 20_MACHINES,
--                  21_RESOURCES, 22_ENERGY, 23_INVENTORY, 24_UPGRADES,
--                  31_SERVER_AUTHORITY, 32_ANTI_ABUSE,
--                  71_ARCHITECTURAL_LAWS.md law 25 and law 26
--
-- LAW 25: the game server is authoritative. Law 26: game resources are NOT money.
--
-- The second point is enforced structurally by the SCHEMA below. There is no
-- column anywhere in these tables that can hold a wallet amount, and no
-- `reward_sources` reference. A game resource physically cannot become money
-- here. The only bridge to money is the Reward Engine, reached through
-- `grant_reward`, and a game reward must name a funded source (law 10).
--
-- CONCURRENCY (doc 31): every player row carries a `state_version` that
-- increments on each committed transition. A client presents the version it
-- based its prediction on, and a mismatch is a rejected action rather than a
-- silent overwrite. That is the optimistic-concurrency guard doc 31 requires
-- against double-spend and duplicate-claim races.
-- =============================================================================

create type app.game_resource_category as enum (
  'RAW_ORE','PROCESSED','CONSUMABLE','FUEL','EVENT'
);

create type app.machine_state as enum (
  'IDLE','RUNNING','UPGRADING','BROKEN','LOCKED'
);

create type app.upgrade_status as enum ('PENDING','COMPLETED','FAILED','CANCELLED');

-- Resource definitions are data-driven (docs 21, 24). Nothing about a resource
-- is hardcoded in a function.
create table app.game_resources (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  category app.game_resource_category not null,
  -- Virtual value, used ONLY inside the game economy (doc 21 VALUATION). This is
  -- NOT a monetary amount and is never summed into a wallet.
  base_value numeric(20,6) not null default 0,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_resources_code_unique unique (code),
  constraint game_resources_code_shape check (code ~ '^[a-z0-9_]{2,40}$'),
  constraint game_resources_value_non_negative check (base_value >= 0)
);

create table app.game_machine_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  -- Doc 22 CONSUMPTION: actions declare an energy cost. Stored here so the cost
  -- is configuration, not a constant in a function.
  energy_cost integer not null default 1,
  production_interval_seconds integer not null default 60,
  base_output_minor bigint not null default 0,
  max_level integer not null default 1,
  unlock_level integer not null default 1,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_machine_types_code_unique unique (code),
  constraint game_machine_types_energy_positive check (energy_cost > 0),
  constraint game_machine_types_interval_positive check (production_interval_seconds > 0),
  constraint game_machine_types_levels check (max_level >= 1 and unlock_level >= 1)
);

-- Doc 22 ENERGY MODEL: current, maximum, regeneration rate and a last-calculation
-- timestamp. Energy is COMPUTED from server time on read, never trusted from a
-- client countdown.
create table app.game_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level integer not null default 1,
  xp bigint not null default 0,
  energy_current integer not null default 100,
  energy_max integer not null default 100,
  energy_regen_per_minute integer not null default 2,
  energy_last_calculated_at timestamptz not null default now(),
  -- Doc 31 CONCURRENCY. Incremented on every committed transition.
  state_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_players_level_positive check (level >= 1),
  constraint game_players_energy_non_negative check (energy_current >= 0),
  constraint game_players_energy_max_positive check (energy_max > 0),
  constraint game_players_energy_within_max check (energy_current <= energy_max),
  constraint game_players_regen_non_negative check (energy_regen_per_minute >= 0),
  constraint game_players_xp_non_negative check (xp >= 0),
  constraint game_players_version_positive check (state_version > 0)
);

create trigger trg_game_players_updated_at
  before update on app.game_players
  for each row execute function app_private.set_updated_at();

create table app.game_machines (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  machine_type_id uuid not null references app.game_machine_types(id) on delete restrict,
  state app.machine_state not null default 'IDLE',
  level integer not null default 1,
  condition numeric(6,3) not null default 1.0,
  location_slot integer,
  -- Last time production was settled. The authoritative clock for doc 20
  -- PRODUCTION: the server computes output from elapsed server time.
  last_produced_at timestamptz not null default now(),
  state_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_machines_level_positive check (level >= 1),
  constraint game_machines_condition_range check (condition >= 0 and condition <= 1),
  constraint game_machines_slot_non_negative check (location_slot is null or location_slot >= 0),
  constraint game_machines_version_positive check (state_version > 0),
  -- One machine per location slot, so two machines cannot share a tile.
  constraint game_machines_slot_unique unique (owner_user_id, location_slot)
);

create index idx_game_machines_owner on app.game_machines(owner_user_id, state);

create trigger trg_game_machines_updated_at
  before update on app.game_machines
  for each row execute function app_private.set_updated_at();

-- Doc 23 INVENTORY. Balances are server-authoritative and persisted with enough
-- history to reconstruct an abnormal change.
create table app.game_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references app.game_resources(id) on delete restrict,
  quantity bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, resource_id),
  constraint game_inventory_quantity_non_negative check (quantity >= 0)
);

create trigger trg_game_inventory_updated_at
  before update on app.game_inventory
  for each row execute function app_private.set_updated_at();

-- Doc 24 UPGRADE DEFINITION: target, level, cost, time, prerequisites and
-- modifiers, all data-driven.
create table app.game_upgrades (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  target_type text not null,
  from_level integer not null default 1,
  to_level integer not null default 2,
  energy_cost integer not null default 0,
  duration_seconds integer not null default 0,
  prerequisite_code text,
  modifier jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_upgrades_code_unique unique (code),
  constraint game_upgrades_levels check (to_level > from_level),
  constraint game_upgrades_duration_non_negative check (duration_seconds >= 0),
  constraint game_upgrades_energy_non_negative check (energy_cost >= 0)
);

create table app.game_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upgrade_id uuid not null references app.game_upgrades(id) on delete restrict,
  machine_id uuid references app.game_machines(id) on delete cascade,
  status app.upgrade_status not null default 'PENDING',
  requested_at timestamptz not null default now(),
  completes_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint game_upgrade_requests_completes_after_request check (completes_at > requested_at)
);

create index idx_game_upgrade_requests_user on app.game_upgrade_requests(user_id, status);

-- Authoritative action event log. Doc 31 OBSERVABILITY: every authoritative
-- action must be traceable for support, anti-abuse and debugging. Append-only.
create table app.game_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  machine_id uuid references app.game_machines(id) on delete cascade,
  event_type text not null,
  action_id text,
  from_version bigint,
  to_version bigint,
  payload jsonb not null default '{}'::jsonb,
  -- Doc 32 SIGNALS. Retained for risk review; never used to alter the ledger.
  client_ip inet,
  created_at timestamptz not null default now()
);

create index idx_game_events_user on app.game_events(user_id, id desc);
create index idx_game_events_action on app.game_events(action_id) where action_id is not null;

create trigger trg_game_events_immutable
  before update or delete on app.game_events
  for each row execute function app_private.reject_mutation();

comment on table app.game_events is 'Append-only authoritative action log. Doc 31 observability and doc 32 anti-abuse signals.';
comment on table app.game_inventory is 'Server-authoritative virtual resource balances. Law 26: these are NOT money and never enter a wallet.';

alter table app.game_resources enable row level security;
alter table app.game_machine_types enable row level security;
alter table app.game_players enable row level security;
alter table app.game_machines enable row level security;
alter table app.game_inventory enable row level security;
alter table app.game_upgrades enable row level security;
alter table app.game_upgrade_requests enable row level security;
alter table app.game_events enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;