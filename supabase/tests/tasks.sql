-- =============================================================================
-- pgTAP: native task invariants
--
-- Spec: 12_TASK_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md laws 1/8/10/12
--
-- The tests that matter most prove that a client claim cannot become money on
-- its own, because doc 12 makes that a structural requirement rather than a
-- procedural one.
-- =============================================================================

begin;

select plan(15);

select has_table('app', 'task_definitions', 'task definitions exist');
select has_table('app', 'task_attempts', 'task attempts exist');
select has_table('app', 'task_verifications', 'task verifications exist');
select has_table('app', 'task_events', 'task event history exists');

-- ---------------------------------------------------------------------------
-- DOC 12 VERIFICATION, part one: a task that pays must declare a verification
-- mechanism. Without this, a task could offer money against no evidence.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    insert into app.task_definitions (
      code, title, state, verification_mechanism,
      reward_amount_minor, reward_unit, funding_source_id
    )
    select 'bad_task', 'Pays with no verification', 'DRAFT', 'NONE', 1000, 'NGN', null
  $$,
  '23514',
  'new row for relation "task_definitions" violates check constraint "task_definitions_paying_task_needs_verification"',
  'a task that pays cannot declare mechanism NONE'
);

-- ---------------------------------------------------------------------------
-- DOC 12 VERIFICATION, part two: a self-attested task can never auto-verify.
-- This is the structural form of "client claims are evidence only".
-- ---------------------------------------------------------------------------
-- The fixture must violate EXACTLY the rule under test. It originally passed
-- funding_source_id = null while also paying 1000, so
-- task_definitions_reward_needs_funding fired first and this test never
-- exercised the self-attestation rule at all - it passed or failed on the wrong
-- constraint. The funding source is created inside the same statement, so the
-- only rule left to break is self-attested + auto-verify.
select throws_ok(
  $$
    with funding as (
      insert into app.reward_sources (
        source_type, name, currency_unit, budget_total_minor, budget_remaining_minor
      )
      values ('AVERRA_PROMOTIONAL', 'Self-attest fixture', 'NGN', 100000, 100000)
      returning id
    )
    insert into app.task_definitions (
      code, title, state, verification_mechanism, auto_verify,
      reward_amount_minor, reward_unit, funding_source_id
    )
    select 'bad_auto', 'Self attested and auto', 'DRAFT', 'SELF_ATTESTED', true,
           1000, 'NGN', funding.id
    from funding
  $$,
  '23514',
  'new row for relation "task_definitions" violates check constraint "task_definitions_self_attested_never_auto_verifies"',
  'a self-attested task cannot be set to auto-verify'
);

select results_eq(
  $$
    select count(*) from app.task_definitions
  $$,
  $$ values (0::bigint) $$,
  'no task is seeded; every task needs an explicit funding source before it can pay'
);

-- Doc 12 FUNDING: a paying task must name a funding source (law 10).
select throws_ok(
  $$
    insert into app.task_definitions (
      code, title, state, verification_mechanism,
      reward_amount_minor, reward_unit
    )
    values ('no_source', 'Pays with no source', 'DRAFT', 'SERVER_RULE', 1000, 'NGN')
  $$,
  '23514',
  'new row for relation "task_definitions" violates check constraint "task_definitions_reward_needs_funding"',
  'a task that pays must name a traceable funding source'
);

select throws_ok(
  $$
    insert into app.task_definitions (
      code, title, state, verification_mechanism, reward_amount_minor, funding_source_id
    )
    values ('no_unit', 'Pays with no unit', 'DRAFT', 'SERVER_RULE', 1000, gen_random_uuid())
  $$,
  '23514',
  'new row for relation "task_definitions" violates check constraint "task_definitions_reward_needs_unit"',
  'a task that pays must name a reward unit'
);

-- Doc 12 ELIGIBILITY / ABUSE CONTROLS.
select throws_ok(
  $$
    insert into app.task_definitions (
      code, title, state, verification_mechanism, max_attempts_per_user
    )
    values ('bad_attempts', 'Zero attempts allowed', 'DRAFT', 'SERVER_RULE', 0)
  $$,
  '23514',
  'new row for relation "task_definitions" violates check constraint "task_definitions_attempts_positive"',
  'a task must allow at least one attempt'
);

-- One attempt per user per attempt number, so a retry cannot fork the history.
select has_index(
  'app', 'task_attempts', 'task_attempts_number_unique',
  'an attempt number is unique per task and user'
);

-- Verification and event history are append-only, so a task's history cannot be
-- quietly rewritten after a disputed payout.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname in ('task_verifications','task_events')
      and t.tgname in ('trg_task_verifications_immutable','trg_task_events_immutable')
  $$,
  $$ values (2::bigint) $$,
  'task verification and event history are both append-only'
);

select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in ('task_definitions','task_attempts','task_verifications','task_events')
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every task table'
);

-- No browser-facing role may verify a completion. A user may claim, but the
-- decision to pay is never theirs (law 8, law 12).
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'start_task_attempt','submit_task_completion','verify_task_completion'
      )
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can start, claim or verify a task attempt'
);

select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text
   from pg_enum e
   join pg_type t on t.oid = e.enumtypid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app' and t.typname = 'verification_mechanism'),
  '{SERVER_EVENT,SERVER_RULE,SELF_ATTESTED,NONE}',
  'the verification mechanism vocabulary matches doc 12'
);

select * from finish();
rollback;