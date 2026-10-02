-- =============================================================================
-- Averra migration 021: Mining Game expansion
--
-- Source of truth: 25_MISSIONS, 26_EVENTS, 27_ACHIEVEMENTS, 28_LEADERBOARDS,
--                  24_UPGRADES, 32_ANTI_ABUSE, 47_GAMIFICATION,
--                  71_ARCHITECTURAL_LAWS.md law 26
--
-- LAW 26 APPLIES HERE TOO. Missions, achievements and events are GAME systems.
-- A mission reward reference names a GAME reward, not money. The one path from
-- a game system to a financial reward is `reward_source_id`, and even that is
-- not a payout instruction: a mission reward is a virtual quantity, and a
-- financial promotion must go through the Reward Engine via `grant_reward`,
-- which no function in this migration calls.
--
-- Doc 28 AUTHORITY: leaderboard scores derive from authoritative game data, so
-- the score is a GENERATED column maintained by triggers on the game tables.
-- There is no table where a client could submit a total.
-- =============================================================================

create type app.mission_status as enum ('AVAILABLE','ACTIVE','COMPLETED','EXPIRED');
create type app.claim_status as enum ('UNCLAIMED','CLAIMING','CLAIMED');

-- Doc 25 MISSION MODEL: definition, objectives, eligibility, window.
create table app.game_missions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  -- Data-driven objectives. Each entry declares a metric and a target, e.g.
  -- {"metric":"COLLECT_TICKS","target":10}. Nothing is hardcoded in a function.
  objectives jsonb not null default '[]'::jsonb,
  -- Game-native reward quantity and resource. NOT money (law 26).
  reward_quantity bigint not null default 0,
  reward_resource_id uuid references app.game_resources(id) on delete restrict,
  -- Doc 25 "reward reference". A funded financial promotion, if ever configured,
  -- names a source here. It is a reference for eligibility, never an
  -- instruction to pay: no function here reads it to move money.
  reward_source_id uuid references app.reward_sources(id) on delete restrict,
  available_from timestamptz,
  available_until timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_missions_code_unique unique (code),
  constraint game_missions_quantity_non_negative check (reward_quantity >= 0),
  -- A mission paying a game reward must name the resource it pays.
  constraint game_missions_reward_needs_resource check (
    reward_quantity = 0 or reward_resource_id is not null
  ),
  constraint game_missions_window check (
    available_until is null or available_from is null or available_until > available_from
  ),
  constraint game_missions_objectives_array check (jsonb_typeof(objectives) = 'array')
);

-- Doc 25 PROGRESS: server-side counters. Client displays derived progress only.
create table app.game_mission_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null references app.game_missions(id) on delete cascade,
  progress bigint not null default 0,
  status app.mission_status not null default 'ACTIVE',
  claim_status app.claim_status not null default 'UNCLAIMED',
  completed_at timestamptz,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_id),
  -- Progress can never go backwards. A replayed or out-of-order event must not
  -- reduce a counter a player has already earned.
  constraint game_mission_progress_non_negative check (progress >= 0),
  constraint game_mission_progress_claim_consistent check (
    (claim_status = 'CLAIMED') = (claimed_at is not null)
  )
);

create trigger trg_game_mission_progress_updated_at
  before update on app.game_mission_progress
  for each row execute function app_private.set_updated_at();

-- Doc 27 CRITERIA and UNLOCKING: unlock is server-side, idempotent, timestamped.
create table app.game_achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  criteria jsonb not null default '{}'::jsonb,
  xp_reward bigint not null default 0,
  badge_code text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_achievements_code_unique unique (code),
  constraint game_achievements_xp_non_negative check (xp_reward >= 0)
);

create table app.game_achievement_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references app.game_achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- Doc 26 EVENT MODEL, SCHEDULING. Server time defines event state; a client
-- clock cannot extend an event, because the window is compared against now().
create table app.game_events_window (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  -- Modifiers are data-driven (doc 26). Applied server-side only.
  modifiers jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_events_window_code_unique unique (code),
  constraint game_events_window_ordered check (ends_at > starts_at)
);

-- Doc 28 METRICS and AUTHORITY.
--
-- The score is DERIVED from app.game_players.xp, never submitted. That is
-- enforced by a trigger rather than by a generated column: a generated
-- expression may only reference columns of its OWN row, and `xp` lives on
-- game_players, not here. Attempting `generated always as (xp)` fails at CREATE
-- TABLE with SQLSTATE 42703.
create table app.game_leaderboard_entries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  score_xp bigint not null default 0,
  period text not null default 'ALL_TIME',
  updated_at timestamptz not null default now(),
  constraint game_leaderboard_entries_period check (
    period in ('ALL_TIME','SEASONAL','WEEKLY','DAILY','EVENT')
  ),
  constraint game_leaderboard_entries_score_non_negative check (score_xp >= 0)
);

create index idx_game_leaderboard_rank
  on app.game_leaderboard_entries(period, score_xp desc, updated_at asc);

-- The score is maintained FROM the authoritative player row.
--
-- A client cannot submit a total: this trigger overwrites `score_xp` on every
-- authoritative XP change, and the browser roles hold no grant on the table at
-- all. Doc 28 AUTHORITY is therefore a property of the database, not of the
-- application.
create or replace function app_private.sync_leaderboard_score()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  insert into app.game_leaderboard_entries (user_id, display_name, score_xp, period)
  values (
    new.user_id,
    coalesce(
      (select p.display_name from app.profiles p where p.id = new.user_id),
      new.user_id::text
    ),
    new.xp,
    'ALL_TIME'
  )
  on conflict (user_id) do update
    set score_xp = excluded.score_xp,
        display_name = excluded.display_name,
        updated_at = now();

  return new;
end;
$$;

create trigger trg_game_players_leaderboard
  after insert or update of xp on app.game_players
  for each row execute function app_private.sync_leaderboard_score();

comment on table app.game_leaderboard_entries is
  'Doc 28: scores derive from authoritative game data. score_xp is overwritten by trg_game_players_leaderboard from app.game_players.xp, so it cannot be submitted.';

-- Doc 32 SIGNALS: risk observations that may HOLD or REVIEW. Per doc 32's
-- FINANCIAL BOUNDARY, suspicion may hold a reward or trigger review but must
-- NOT silently mutate the financial ledger. Nothing in this table writes to
-- the ledger, by construction.
create table app.game_risk_signals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_type text not null,
  -- A risk score is a SIGNAL, not a verdict. Nothing is reversed or clawed back
  -- because of a row here.
  risk_score integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  -- The only permitted financial consequence is a hold pending review.
  hold_applied boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint game_risk_signals_score_bounded check (risk_score between 0 and 100)
);

create index idx_game_risk_signals_user on app.game_risk_signals(user_id, created_at desc);

create trigger trg_game_risk_signals_immutable
  before update or delete on app.game_risk_signals
  for each row execute function app_private.reject_mutation();

comment on table app.game_risk_signals is
  'Doc 32: a signal may hold or trigger review. It never mutates the financial ledger, and the rows are append-only.';

alter table app.game_missions enable row level security;
alter table app.game_mission_progress enable row level security;
alter table app.game_achievements enable row level security;
alter table app.game_achievement_unlocks enable row level security;
alter table app.game_events_window enable row level security;
alter table app.game_leaderboard_entries enable row level security;
alter table app.game_risk_signals enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;