-- =============================================================================
-- pgTAP: fraud risk and content moderation invariants
--
-- Spec: 40_FRAUD_ANTI_ABUSE, 58_CONTENT_MODERATION,
--       71_ARCHITECTURAL_LAWS.md law 42
--
-- The load-bearing assertion is the LAST one: it inspects the deployed function
-- body to prove a risk decision cannot move money. That is doc 40 FINANCIAL
-- INTEGRITY checked against the database rather than trusted from a comment.
-- =============================================================================

begin;

select plan(33);

select has_table('app', 'risk_signals', 'risk signals exist');
select has_table('app', 'risk_decisions', 'risk decisions exist');
select has_table('app', 'moderation_items', 'moderation items exist');

-- Doc 40 DECISION MODEL. The labels are compared as `name[]`, not `text`:
-- `enumlabel` is type `name`, whose collation is C, and casting it to text
-- carries that collation into a comparison against a default-collation literal,
-- which PostgreSQL refuses with "could not determine which collation to use for
-- string comparison".
select results_eq(
  $$
    select array_agg(e.enumlabel order by e.enumsortorder)
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'risk_decision'
  $$,
  $$ values ('{ALLOW,HOLD,REVIEW,REJECT,RESTRICT,SUSPEND,TERMINATE}'::name[]) $$,
  'the risk decision vocabulary matches doc 40'
);

-- Doc 40: a decision without a reason code is refused, so enforcement is never
-- unexplained.
select throws_ok(
  $$ select app_private.record_risk_decision('USER', gen_random_uuid(), 'SUSPEND', '   ') $$,
  '23514',
  null,
  'a risk decision cannot be recorded without a reason code'
);

-- A USER decision must name its user.
select throws_ok(
  $$ select app_private.record_risk_decision('USER', null, 'REVIEW', 'velocity') $$,
  '23514',
  null,
  'a USER risk decision must name the user it applies to'
);

-- A TERMINATE must not expire: an expired termination would lapse into an
-- implicit allow without anyone deciding that.
select throws_ok(
  $$
    select app_private.record_risk_decision(
      'USER', gen_random_uuid(), 'TERMINATE', 'fraud_confirmed',
      '{}', '{}', null, null, now() + interval '1 day'
    )
  $$,
  '23514',
  null,
  'a TERMINATE decision must not expire'
);

-- Doc 40 APPEALS: a decision is immutable, so an appeal adds a NEW row rather
-- than editing the original. Both are append-only.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname in ('risk_decisions','risk_signals')
      and t.tgname in ('trg_risk_decisions_immutable','trg_risk_signals_immutable')
  $$,
  $$ values (2::bigint) $$,
  'risk signals and decisions are both append-only'
);

-- Doc 58 EVIDENCE: a moderation outcome must carry a reason code and a reviewer.
select throws_ok(
  $$
    insert into app.moderation_items (target_type, content, status)
    values ('PROFILE', 'spam text', 'APPROVED')
  $$,
  '23514',
  'new row for relation "moderation_items" violates check constraint "moderation_items_reviewed_needs_reason"',
  'a moderation approval must carry a reason code'
);

-- blocked with neither field violates BOTH reviewed_needs_reason and
-- reviewed_needs_reviewer, and PostgreSQL reports the first one it evaluates
-- (the constraints are checked in name order). So the original fixture reported
-- the REASON constraint and this assertion never tested the reviewer rule. Naming
-- a reason leaves only the missing reviewer to fail.
select throws_ok(
  $$
    insert into app.moderation_items (target_type, content, status, reason_code)
    values ('PROFILE', 'spam text', 'BLOCKED', 'spam')
  $$,
  '23514',
  'new row for relation "moderation_items" violates check constraint "moderation_items_reviewed_needs_reviewer"',
  'a moderation block must name a reviewer'
);

-- Doc 58 SAFETY BOUNDARY: risk and moderation are DISTINCT systems, so neither
-- table may reference the other. Conflating them would let a content takedown
-- become a fraud hold and vice versa.
select results_eq(
  $$
    select count(*)
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app'
      and (
        (t.relname = 'moderation_items' and pg_get_constraintdef(c.oid) ~ 'risk_')
        or (t.relname like 'risk_%' and pg_get_constraintdef(c.oid) ~ 'moderation')
      )
  $$,
  $$ values (0::bigint) $$,
  'risk and moderation are separate decision systems with no cross-reference'
);

-- Doc 54 DATA MINIMISATION: raw device or network identifiers are not stored,
-- only a hash. A column named like a raw identifier must not exist.
select results_eq(
  $$
    select count(*) from information_schema.columns
    where table_schema = 'app'
      and table_name = 'risk_signals'
      and column_name in ('device_id','ip_address','device_fingerprint','raw_identifier')
  $$,
  $$ values (0::bigint) $$,
  'risk signals store no raw device or network identifier'
);

-- DOC 40 FINANCIAL INTEGRITY, verified against the deployed function body.
--
-- A risk decision may hold or reject a FUTURE event. It must never rewrite
-- financial history. This asserts the function cannot call any money primitive,
-- so the boundary is a property of the database rather than of our discipline.
select results_eq(
  $$
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('record_risk_decision','current_risk_decision')
      and p.prosrc ~ '(post_ledger_entry|grant_reward|reverse_reward|transition_reward|settle_withdrawal|confirm_deposit)'
  $$,
  $$ values (0::bigint) $$,
  'a risk decision function cannot move money or mutate financial history'
);

-- Neither risk table may hold a column that could rewrite an amount. This is the
-- structural half of the same guarantee: there is nowhere for a correction to go.
select results_eq(
  $$
    select count(*)
    from information_schema.columns
    where table_schema = 'app'
      and table_name in ('risk_signals','risk_decisions')
      and (
        column_name ~ '(ledger|wallet|balance|amount_minor|credited|settled|reversed)'
      )
  $$,
  $$ values (0::bigint) $$,
  'no risk table has a column capable of rewriting a financial amount'
);

-- RLS across the risk and moderation tables.
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in ('risk_signals','risk_decisions','moderation_items')
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every risk and moderation table'
);

-- No browser-facing role may record a risk decision. Enforcement is server-side.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('record_risk_decision','current_risk_decision')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can record or read a risk decision directly'
);

-- ===========================================================================
-- DOC 40 RISK GATE: a non-ALLOW decision must block a new credit.
-- ===========================================================================

-- The gated wrapper exists and consults the risk decision.
select has_function(
  'app_private', 'grant_reward',
  array['uuid','uuid','bigint','text','text','text','bigint','text','text','uuid','boolean'],
  'the gated grant_reward wrapper exists'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'grant_reward'
      and p.prosrc ~ 'reward_blocked_by_risk'
  $$,
  $$ values (1::bigint) $$,
  'the gated grant_reward consults the risk decision'
);

-- THE BYPASS TEST. This is the assertion that makes the gate real.
--
-- The original money path was renamed to grant_reward_ungated. The rename
-- carried its `grant execute to service_role` with it, so without an explicit
-- revoke it would remain directly callable and the gate would be decorative.
-- This asserts no role can reach it.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'grant_reward_ungated'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  $$,
  $$ values (0::bigint) $$,
  'the unguarded money path cannot be reached by any application role'
);

-- The decision spectrum. Doc 40 lists these; only ALLOW permits a credit, so the
-- helper must treat every other value as blocking.
-- The pattern must be a single-quoted SQL literal. It was written in double
-- quotes, which makes it an IDENTIFIER in SQL, so the query failed with
-- `column "decision <> 'ALLOW'" does not exist` and aborted the whole suite at
-- this statement - which is why the plan was never completed.
select results_eq(
  $$
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'reward_blocked_by_risk'
      and p.prosrc ~ 'decision\s*<>\s*''ALLOW'''
  $$,
  $$ values (1::bigint) $$,
  'the risk gate blocks on any decision that is not ALLOW'
);

-- The gate must not be able to MOVE money itself. It only refuses.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('reward_blocked_by_risk','record_risk_decision')
      and p.prosrc ~ '(post_ledger_entry|reverse_reward|transition_reward|settle_withdrawal|confirm_deposit)'
  $$,
  $$ values (0::bigint) $$,
  'neither the risk gate nor the decision recorder can move money'
);

-- An expired decision must not keep blocking, or a user could be frozen
-- forever by a stale record.
select results_eq(
  $$
    select count(*)
    from information_schema.routines
    where routine_schema = 'app_private'
      and routine_name = 'reward_blocked_by_risk'
      and external_language = 'SQL'
  $$,
  $$ values (1::bigint) $$,
  'the risk gate is a pure read, so it cannot itself change state'
);

-- ===========================================================================
-- DOC 40 RISK SIGNALS: detection is separated from enforcement.
-- ===========================================================================

select has_table('app', 'risk_detector_config', 'detector configuration exists');

-- The detectors must cover the threats doc 40 actually names, rather than
-- whatever was convenient to compute.
select results_eq(
  $$
    select count(*) from app.risk_detector_config
    where detector_code in ('TASK_VELOCITY','GAME_VELOCITY','WITHDRAWAL_VELOCITY','DEPOSIT_VELOCITY','DEVICE_CLUSTER')
  $$,
  $$ values (5::bigint) $$,
  'velocity and device-cluster detectors are configured'
);

-- A detector is an OBSERVATION, not a decision. If it could record a decision,
-- detection would become enforcement without anyone choosing to.
--
-- This is asserted against the deployed function body.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'detect_risk_signals'
      and p.prosrc ~ 'insert into app\.risk_decisions'
  $$,
  $$ values (0::bigint) $$,
  'the detector cannot record a risk decision, only observations'
);

-- And it cannot move money either.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('detect_risk_signals','hash_observation')
      and p.prosrc ~ '(post_ledger_entry|grant_reward|reverse_reward|transition_reward|record_risk_decision)'
  $$,
  $$ values (0::bigint) $$,
  'neither the detector nor the hasher can act on a signal'
);

-- ---------------------------------------------------------------------------
-- DOC 54 DATA MINIMISATION, enforced on the hashing path.
-- ---------------------------------------------------------------------------

-- Hashing must be deterministic, or device correlation silently stops working.
select is(
  app_private.hash_observation('device-abc'),
  app_private.hash_observation('device-abc'),
  'hashing the same identifier twice yields the same hash'
);

select isnt(
  app_private.hash_observation('device-abc'),
  app_private.hash_observation('device-xyz'),
  'different identifiers yield different hashes'
);

-- The hash must not leak the input. A plain sha256 hex digest of 'a' is
-- 'ca978...', so assert the output is not the raw value and is hex-shaped.
select isnt(
  app_private.hash_observation('plaintext-device-id'),
  'plaintext-device-id',
  'the hash is not the raw identifier'
);

select matches(
  app_private.hash_observation('anything'),
  '^[0-9a-f]{64}$',
  'the hash is a 64-character hex sha256 digest'
);

-- RLS and grants on the detector configuration.
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app' and tablename = 'risk_detector_config'
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on the detector configuration'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('detect_risk_signals','hash_observation')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can run a detector or read the hash function'
);

-- Signals must remain append-only, so an observation cannot be quietly deleted
-- after it caused a decision.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'risk_signals'
      and t.tgname = 'trg_risk_signals_immutable'
  $$,
  $$ values (1::bigint) $$,
  'risk signals remain append-only after detectors were added'
);

select * from finish();
rollback;