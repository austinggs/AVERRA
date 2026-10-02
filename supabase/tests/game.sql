-- =============================================================================
-- pgTAP: Mining Game foundation invariants
--
-- Spec: 20_MACHINES, 22_ENERGY, 31_SERVER_AUTHORITY, 32_ANTI_ABUSE,
--       71_ARCHITECTURAL_LAWS.md law 25 and law 26
--
-- The tests that matter most prove law 26 STRUCTURALLY: that no game table can
-- even hold a monetary amount, and that no game command reaches a ledger
-- function. A comment asserting this would be worthless, so these are asserted
-- against the live catalogue.
-- =============================================================================

begin;

select plan(15);

select has_table('app', 'game_players', 'game players exist');
select has_table('app', 'game_machines', 'game machines exist');
select has_table('app', 'game_inventory', 'game inventory exists');
select has_table('app', 'game_events', 'the authoritative action log exists');

-- ---------------------------------------------------------------------------
-- LAW 26: game resources are NOT money.
--
-- Asserted by proving there is no monetary column anywhere in the game schema,
-- and no reference to a wallet account. This is stronger than a comment.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*)
    from information_schema.columns
    where table_schema = 'app'
      and table_name like 'game_%'
      and (
        column_name ~ '(ledger|wallet|account|balance_minor|amount_minor|credited|settled)'
        or column_name ~ '(naira|ngn|usd|token_amount)'
      )
  $$,
  $$ values (0::bigint) $$,
  'no game table has a column capable of holding money'
);

-- Game tables must not reference a reward source either: the only bridge to
-- money is the Reward Engine, reached through grant_reward, never a game column.
--
-- ONE exception is deliberate and documented. Doc 25 REWARDS allows a mission
-- reward to be "a financially funded reward", and migration 021 gives
-- app.game_missions a nullable `reward_source_id` for exactly that: an
-- ELIGIBILITY reference that no game function reads to move money (the assertion
-- below proves the game commands cannot reach the ledger). CR-0006 records the
-- decision. Naming that one table keeps the test strong in both directions: it
-- fails if the exception disappears, and it fails the moment any OTHER game table
-- gains a direct path to a funding source.
--
-- The labels are compared as `name[]`, not `text`: `relname` is type `name`,
-- whose collation is C, and casting it to text carries that collation into a
-- comparison against a default-collation literal, which PostgreSQL refuses with
-- "could not determine which collation to use for string comparison".
select results_eq(
  $$
    select coalesce(array_agg(distinct t.relname order by t.relname), '{}'::name[])
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app'
      and t.relname like 'game_%'
      and pg_get_constraintdef(c.oid) ~ 'reward_sources'
  $$,
  $$ values ('{game_missions}'::name[]) $$,
  'the only game table referencing a funding source is the documented game_missions eligibility link'
);

-- No game command function may reach the ledger. Proved by inspecting the
-- function bodies, not by trusting the comment above them.
select results_eq(
  $$
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('perform_game_action', 'regenerate_energy', 'assert_game_version')
      and p.prosrc ~ '(grant_reward|post_ledger_entry|transition_reward|create_withdrawal_request)'
  $$,
  $$ values (0::bigint) $$,
  'no game command function can move money'
);

-- ---------------------------------------------------------------------------
-- DOC 22 ENERGY MODEL: energy is server-computed and bounded.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'game_players'
      and c.conname in ('game_players_energy_non_negative','game_players_energy_within_max')
  $$,
  $$ values (2::bigint) $$,
  'energy can never be negative or exceed its maximum'
);

-- ---------------------------------------------------------------------------
-- DOC 31 CONCURRENCY: a version exists to be compared.
-- ---------------------------------------------------------------------------
select has_column('app', 'game_players', 'state_version', 'the player row carries a state version');

-- A version check against a non-existent player must fail closed.
select throws_ok(
  $$ select app_private.assert_game_version(gen_random_uuid(), 1) $$,
  '23503',
  'assert_game_version: no game player for user',
  'a version check against a non-existent player fails closed'
);

-- ---------------------------------------------------------------------------
-- DOC 31 OBSERVABILITY and DOC 32: the action log is append-only.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname = 'game_events'
      and t.tgname = 'trg_game_events_immutable'
  $$,
  $$ values (1::bigint) $$,
  'the game action log is append-only'
);

-- One machine per location slot, so two machines cannot occupy one tile.
select has_index(
  'app', 'game_machines', 'game_machines_slot_unique',
  'a location slot holds at most one machine per owner'
);

-- Condition is a ratio, not an unbounded number that could inflate output.
select throws_ok(
  $$
    insert into app.game_players (user_id, energy_current, energy_max)
    values (gen_random_uuid(), 500, 100)
  $$,
  '23514',
  'new row for relation "game_players" violates check constraint "game_players_energy_within_max"',
  'energy cannot be set above its own maximum'
);

-- No browser-facing role may perform a game action. The game server is
-- authoritative, and a client must not be able to drive the world directly.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'perform_game_action'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can perform a game action'
);

-- RLS everywhere on the game schema.
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename like 'game_%'
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every game table'
);

select * from finish();
rollback;