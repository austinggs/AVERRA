-- =============================================================================
-- pgTAP: Mining Game expansion invariants
--
-- Spec: 24_UPGRADES, 25_MISSIONS, 27_ACHIEVEMENTS, 28_LEADERBOARDS,
--       31_SERVER_AUTHORITY, 32_ANTI_ABUSE, 71_ARCHITECTURAL_LAWS.md law 26
--
-- The load-bearing assertions are the last few: they prove the expansion
-- systems cannot pay money, that a mission cannot pay twice, and that a
-- leaderboard score cannot be submitted by a client.
-- =============================================================================

begin;

select plan(17);

select has_table('app', 'game_missions', 'game missions exist');
select has_table('app', 'game_mission_progress', 'mission progress exists');
select has_table('app', 'game_achievements', 'achievements exist');
select has_table('app', 'game_leaderboard_entries', 'leaderboard entries exist');
select has_table('app', 'game_risk_signals', 'risk signals exist');

-- ---------------------------------------------------------------------------
-- LAW 26 EXTENDED. The expansion tables must not have gained a money path.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('deploy_machine','request_machine_upgrade','claim_mission')
      and p.prosrc ~ '(grant_reward|post_ledger_entry|create_withdrawal_request|transition_reward)'
  $$,
  $$ values (0::bigint) $$,
  'no expansion command can move money'
);

-- ---------------------------------------------------------------------------
-- DOC 28 AUTHORITY: a leaderboard score must not be client-submittable.
--
-- The score is derived from app.game_players.xp by a trigger. It was originally
-- a GENERATED column, which is impossible here: a generated expression may only
-- reference its own row, and `xp` is a column of game_players, not of this
-- table. See DISCREPANCIES Q-14.
--
-- The trigger overwrites score_xp on every authoritative XP change, so a client
-- cannot supply a total even if it could write the row at all.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname = 'game_players'
      and t.tgname = 'trg_game_players_leaderboard'
  $$,
  $$ values (1::bigint) $$,
  'the leaderboard score is maintained from authoritative player XP'
);

-- The trigger must take its score from the player row rather than trusting an
-- incoming value.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'sync_leaderboard_score'
      and p.prosrc ~ 'new\.xp'
  $$,
  $$ values (1::bigint) $$,
  'the leaderboard trigger derives its score from the authoritative player row'
);

-- A score can never be negative.
select throws_ok(
  $$
    insert into app.game_leaderboard_entries (user_id, display_name, score_xp)
    values (gen_random_uuid(), 'Negative', -1)
  $$,
  '23514',
  'new row for relation "game_leaderboard_entries" violates check constraint "game_leaderboard_entries_score_non_negative"',
  'a leaderboard score cannot be negative'
);

-- Doc 32 FINANCIAL BOUNDARY: risk signals may hold or review, but the table
-- itself cannot be used to silently rewrite that decision.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname = 'game_risk_signals'
      and t.tgname = 'trg_game_risk_signals_immutable'
  $$,
  $$ values (1::bigint) $$,
  'risk signals are append-only, so a hold cannot be silently rewritten'
);

-- ---------------------------------------------------------------------------
-- DOC 25 CLAIMING: a mission cannot pay twice. The claim status and its
-- timestamp must agree, so "CLAIMED" is never asserted without evidence.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'game_mission_progress'
      and c.conname = 'game_mission_progress_claim_consistent'
  $$,
  $$ values (1::bigint) $$,
  'a mission cannot be marked claimed without a claim timestamp'
);

-- Progress can never run backwards, so a replayed event cannot reduce a counter
-- the player has already earned.
-- The fixture must create the mission it references. `(select id from
-- app.game_missions limit 1)` evaluates to NULL because no mission is seeded, so
-- the insert died on the NOT NULL constraint for mission_id (23502) and never
-- reached the rule under test. Inserting the mission in the same statement puts
-- mission progress in front of the rule it claims to test.
select throws_ok(
  $$
    with mission as (
      insert into app.game_missions (code, name)
      values ('progress_fixture', 'Progress fixture')
      returning id
    )
    insert into app.game_mission_progress (user_id, mission_id, progress)
    select gen_random_uuid(), mission.id, -1 from mission
  $$,
  '23514',
  'new row for relation "game_mission_progress" violates check constraint "game_mission_progress_non_negative"',
  'mission progress cannot be negative'
);

-- A mission paying a game reward must name the resource it pays.
select results_eq(
  $$
    select count(*) from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'game_missions'
      and c.conname = 'game_missions_reward_needs_resource'
  $$,
  $$ values (1::bigint) $$,
  'a mission paying a resource must name that resource'
);

-- ---------------------------------------------------------------------------
-- Doc 20/24/25: these are authoritative commands, so no browser-facing role
-- may execute them.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('deploy_machine','request_machine_upgrade','claim_mission')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can deploy, upgrade or claim'
);

-- Doc 26 SCHEDULING: an event window must be ordered, so a window cannot be
-- created that ends before it starts.
select throws_ok(
  $$
    insert into app.game_events_window (code, name, starts_at, ends_at)
    values ('bad_window', 'Inverted', now() + interval '1 hour', now())
  $$,
  '23514',
  'new row for relation "game_events_window" violates check constraint "game_events_window_ordered"',
  'an event window must end after it starts'
);

-- RLS across the expansion tables.
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in (
        'game_missions','game_mission_progress','game_achievements',
        'game_achievement_unlocks','game_events_window',
        'game_leaderboard_entries','game_risk_signals'
      )
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every expansion table'
);

-- `name[]`, not `text`: see the note on the risk vocabulary assertion.
select results_eq(
  $$
    select array_agg(e.enumlabel order by e.enumsortorder)
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'claim_status'
  $$,
  $$ values ('{UNCLAIMED,CLAIMING,CLAIMED}'::name[]) $$,
  'the mission claim vocabulary matches doc 25'
);

select * from finish();
rollback;