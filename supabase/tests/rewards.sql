-- =============================================================================
-- pgTAP: reward engine invariants
--
-- Spec: 35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt,
--       71_ARCHITECTURAL_LAWS.md laws 1/2/5/6/7/10/16
-- =============================================================================

begin;

select plan(13);

select has_table('app', 'rewards', 'rewards table exists');
select has_table('app', 'reward_sources', 'reward sources table exists');
select has_table('app', 'reward_state_transitions', 'reward state transitions exist');
select has_table('app', 'reward_caps', 'reward caps exist');

-- ---------------------------------------------------------------------------
-- law 5: one source event produces at most one reward. This is the
-- duplicate-callback guarantee, enforced by the database rather than by the
-- adapter remembering what it already saw.
-- ---------------------------------------------------------------------------
select has_index(
  'app', 'rewards', 'uq_rewards_source_event',
  'a unique index prevents one source event producing two rewards'
);

-- ---------------------------------------------------------------------------
-- law 10: a reward without a funding source is impossible.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.rewards (
      user_id, source_id, state, amount_minor, unit,
      event_type, source_event_id, idempotency_key
    )
    values (
      gen_random_uuid(), gen_random_uuid(), 'PENDING', 100, 'NGN',
      'TASK_COMPLETED', 'evt-1', 'k1'
    )
  $$,
  '23503',
  null,
  'a reward cannot reference a non-existent funding source'
);

-- law 1: a source can never report more remaining budget than it ever held.
select throws_ok(
  $$
    insert into app.reward_sources (
      source_type, name, currency_unit, budget_total_minor, budget_remaining_minor
    )
    values ('AVERRA_PROMOTIONAL', 'Over-allocated', 'NGN', 1000, 5000)
  $$,
  '23514',
  'new row for relation "reward_sources" violates check constraint "reward_sources_remaining_within_total"',
  'a source cannot hold more remaining budget than its total'
);

select throws_ok(
  $$
    insert into app.reward_sources (
      source_type, name, currency_unit, budget_total_minor, budget_remaining_minor
    )
    values ('AVERRA_PROMOTIONAL', 'Negative', 'NGN', 1000, -1)
  $$,
  '23514',
  'new row for relation "reward_sources" violates check constraint "reward_sources_budget_non_negative"',
  'a negative budget is rejected'
);

select throws_ok(
  $$
    insert into app.reward_sources (source_type, name)
    values ('UNSOURCED_MAGIC', 'Not a real funding type')
  $$,
  '23514',
  'new row for relation "reward_sources" violates check constraint "reward_sources_type_check"',
  'only provider, advertiser and approved promotional budgets are valid funding sources'
);

-- ---------------------------------------------------------------------------
-- law 7: reward history is append-only.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname = 'reward_state_transitions'
      and t.tgname = 'trg_reward_state_transitions_immutable'
  $$,
  $$ values (1::bigint) $$,
  'reward state transitions are protected by an append-only trigger'
);

-- No browser-facing role may create or reverse a reward (law 44).
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('grant_reward','transition_reward','reverse_reward')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can grant, transition or reverse a reward'
);

-- ---------------------------------------------------------------------------
-- The reward enum mirrors doc 35 exactly, not the coarser doc 05 prose.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text
   from pg_enum e
   join pg_type t on t.oid = e.enumtypid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app' and t.typname = 'reward_state'),
  '{ELIGIBLE,PENDING,AVAILABLE,ON_HOLD,REVERSED,CHARGEBACK,CANCELLED,EXPIRED}',
  'reward_state matches the doc 35 normative list exactly'
);

select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in ('rewards','reward_sources','reward_state_transitions','reward_caps')
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every reward table'
);

select * from finish();
rollback;