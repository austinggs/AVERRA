
-- ==========================================================================
-- PROVIDER REVERSALS (migrations 057 / 058).
--
-- THE DEFECT THESE ASSERT AGAINST
--
-- CPX re-notifies a transaction with the SAME trans_id and status -2, 15-60 days
-- later. Recorded under the bare trans_id, law 5's unique index returned the ORIGINAL
-- conversion as a DUPLICATE - so the fraud clawback was discarded with no reversal row,
-- no reverse_conversion call, and no error anywhere, while the vendor dashboard showed
-- the reversal delivered.
--
-- Every assertion below therefore exists to answer one question: did the reversal
-- become its OWN row, linked to the original, WITHOUT the original being rewritten?
--
-- The suite runs inside the runner's transaction and is rolled back, so it creates no
-- lasting rows.
-- ==========================================================================

-- The plan is declared FIRST, before any assertion. pgTAP rejects a test run without
-- one, and a plan placed after the first assertion fails the whole suite with
-- "produced no assertions at all" - which reads like a suite that never ran rather than
-- like an ordering mistake.
select plan(22);

select has_column(
  'app', 'provider_conversions', 'reverses_conversion_id',
  'a conversion can name the conversion it reverses'
);

-- col_is_fk is not available in the deployed pgTAP build, and its argument count
-- varies between versions. Asserting the same property with a query is version-proof:
-- a foreign key exists exactly when a pg_constraint of type 'f' does.
select results_eq(
  $$
    select count(*)
    from pg_constraint c
    where c.conrelid = 'app.provider_conversions'::regclass
      and c.contype = 'f'
      and c.conkey = ARRAY[
        (select attnum from pg_attribute
         where attrelid = 'app.provider_conversions'::regclass
           and attname = 'reverses_conversion_id')
      ]::smallint[]
      and c.confrelid = 'app.provider_conversions'::regclass
  $$,
  $$ values (1::bigint) $$,
  'the reversal link is a real foreign key back to provider_conversions'
);

-- The constraint that stops a conversion claiming to reverse itself. Without it,
-- apply_provider_reversal could be handed its own id, find "the original" already
-- REVERSED, and report success having moved nothing.
--
-- Asserted via pg_constraint because has_check is not present in the deployed pgTAP
-- build. A CHECK constraint exists exactly when a pg_constraint of type 'c' does.
select results_eq(
  $$
    select count(*)
    from pg_constraint c
    where c.conrelid = 'app.provider_conversions'::regclass
      and c.contype = 'c'
      and c.conname = 'provider_conversions_no_self_reversal'
  $$,
  $$ values (1::bigint) $$,
  'a conversion cannot be its own reversal'
);

-- The constraint must actually say something. A check constraint with a tautological
-- body would satisfy the assertion above while permitting exactly the self-reversal it
-- exists to prevent, so its definition is pinned.
--
-- `pg_get_constraintdef`, not `pg_constraint.consrc`: the latter was removed in
-- PostgreSQL 12, and this database is newer.
select is(
  (
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = 'app.provider_conversions'::regclass
      and c.conname = 'provider_conversions_no_self_reversal'
  ),
  'CHECK (((reverses_conversion_id IS NULL) OR (reverses_conversion_id <> id)))',
  'the self-reversal check compares the link to the row id, rather than being a no-op'
);

-- Both reversal commands must exist in app_private, and neither may be callable by a
-- browser-facing role. A reversal moves money, so this is the privilege boundary that
-- matters most in this migration.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('apply_provider_reversal','record_provider_reversal_conversion')
  $$,
  $$ values (2::bigint) $$,
  'both reversal commands exist in app_private'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('apply_provider_reversal','record_provider_reversal_conversion')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can apply or record a provider reversal'
);

-- THE PUBLIC SURFACE. A function in `public` is born executable by an unauthenticated
-- caller, so each must revoke before it grants.
--
-- Three reversal functions are reachable from `public`: the two forwarders, plus
-- `get_original_conversion_for_reversal`, which migration 057 defines directly there
-- because a narrow read has no privileged body worth hiding. What matters is that all
-- three are revoked, not which schema they were written in.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'apply_provider_reversal',
        'record_provider_reversal_conversion',
        'get_original_conversion_for_reversal'
      )
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  $$ values (3::bigint) $$,
  'every public reversal function is revoked from anon and authenticated'
);

-- --------------------------------------------------------------------------
-- The behaviour, on a real fixture.
-- --------------------------------------------------------------------------

-- DEFENSIVE CLEANUP, and it exists because it was needed.
--
-- The runner wraps each suite in begin/rollback, so a PASSING suite leaves nothing
-- behind. A suite that ERRORS mid-way does not: this one aborted on an unavailable
-- pgTAP function three times, and each aborted run committed a partial fixture. The
-- rows survived, and on the next run the completion was correctly reported as a
-- DUPLICATE - a failure caused by the previous failure, which is exactly the kind of
-- thing that gets misread as a real defect.
--
-- Reversals are deleted first because they carry the foreign key. The prefix is
-- specific enough that this cannot touch a real conversion.
delete from app.provider_conversions where provider_event_id like 'pgtap-%:-2';
delete from app.provider_conversions where provider_event_id like 'pgtap-%';

create temporary table rev_fixture as
select
  (select id from app.providers where code = 'cpx_research') as provider_id,
  'pgtap-transaction-0001'::text as trans_id;

-- The completion, recorded through the ordinary migration 034 command.
select is(
  app_private.record_provider_conversion(
    (select provider_id from rev_fixture),
    (select trans_id from rev_fixture),
    'SURVEY', 'cpx:complete',
    p_status => 'VALIDATED',
    p_gross_value_minor => 66265,
    p_currency => 'NGN-kobo'
  ) ->> 'isDuplicate',
  'false',
  'a completion records as a new conversion'
);

-- The reversal, carrying the vendor status suffix. This is the identity change that
-- stops the unique index from collapsing it onto the completion.
select is(
  app_private.record_provider_reversal_conversion(
    (select provider_id from rev_fixture),
    (select trans_id from rev_fixture) || ':-2',
    (select trans_id from rev_fixture),
    'SURVEY', 'cpx:complete',
    p_gross_value_minor => 66265,
    p_currency => 'NGN-kobo'
  ) ->> 'isDuplicate',
  'false',
  'THE CORE ASSERTION: a -2 reversal is NOT discarded as a duplicate of its completion'
);

select is(
  app_private.record_provider_reversal_conversion(
    (select provider_id from rev_fixture),
    (select trans_id from rev_fixture) || ':-2',
    (select trans_id from rev_fixture),
    'SURVEY', 'cpx:complete'
  ) ->> 'isDuplicate',
  'true',
  'a REPLAYED reversal collapses onto the same row (law 5 still holds)'
);

-- The link was resolved in SQL, in the same transaction as the insert.
select results_eq(
  $$
    select count(*)
    from app.provider_conversions r
    join app.provider_conversions o on o.id = r.reverses_conversion_id
    where r.provider_event_id = (select trans_id from rev_fixture) || ':-2'
      and o.provider_event_id = (select trans_id from rev_fixture)
  $$,
  $$ values (1::bigint) $$,
  'the reversal is linked to the original completion'
);

-- APPEND-ONLY. The original must still say what the provider originally said. If this
-- count is 0, something rewrote history rather than adding a compensating entry
-- (law 7, law 42).
select is(
  (
    select status::text from app.provider_conversions
    where provider_event_id = (select trans_id from rev_fixture)
  ),
  'VALIDATED',
  'the original completion is NOT rewritten by the arrival of its reversal'
);

-- The reversal row is itself REVERSED, and carries no user. A reversal that attributed
-- a user would be a second attribution of the same click.
select results_eq(
  $$
    select count(*) from app.provider_conversions
    where provider_event_id = (select trans_id from rev_fixture) || ':-2'
      and status = 'REVERSED'
      and user_id is null
      and tracking_id is null
  $$,
  $$ values (1::bigint) $$,
  'the reversal is REVERSED and attributes nobody'
);

-- An unmatched reversal is RECORDED, not refused. A vendor may withdraw a transaction
-- whose completion never reached us; discarding that evidence is the mistake this
-- migration exists to prevent.
select is(
  app_private.record_provider_reversal_conversion(
    (select provider_id from rev_fixture),
    'pgtap-never-completed:-2',
    'pgtap-never-completed',
    'SURVEY', 'cpx:complete'
  ) ->> 'matched',
  'false',
  'an unmatched reversal is recorded rather than refused'
);

select is(
  (
    select count(*)::text from app.provider_conversions
    where provider_event_id = 'pgtap-never-completed:-2'
  ),
  '1',
  'and the unmatched reversal row still exists'
);

-- Applying it is a SUCCESS with nothing to claw back, because no provider is LIVE and
-- therefore no conversion was ever converted into a reward.
select is(
  app_private.apply_provider_reversal(
    (select id from app.provider_conversions
     where provider_event_id = (select trans_id from rev_fixture) || ':-2'),
    'cpx reported status -2: reversed as fraud'
  ) ->> 'outcome',
  'no_reward',
  'applying a reversal of an unpaid conversion reports no_reward, not an error'
);

-- Idempotent replay of the APPLY. reverse_conversion is itself idempotent, so a second
-- call must not move money twice.
select is(
  app_private.apply_provider_reversal(
    (select id from app.provider_conversions
     where provider_event_id = (select trans_id from rev_fixture) || ':-2'),
    'cpx reported status -2: reversed as fraud'
  ) ->> 'outcome',
  'no_reward',
  'applying the same reversal twice is safe'
);

-- A ROW THAT IS NOT A REVERSAL IS REFUSED, rather than reported as reversed. Handing
-- the command an ordinary completion would otherwise claim success on a conversion
-- that was never withdrawn.
--
-- `throws_ok` compares SQLERRM by EXACT equality, so the full message including the
-- substituted id is required - a bare errcode would also be satisfied by the wrong
-- check constraint on this table, which carries several.
select throws_ok(
  $$
    select app_private.apply_provider_reversal(
      (select id from app.provider_conversions
       where provider_event_id = (select trans_id from rev_fixture)),
      'not actually a reversal'
    )
  $$,
  '23514',
  'apply_provider_reversal: conversion ' || (
    select id::text from app.provider_conversions
    where provider_event_id = (select trans_id from rev_fixture)
  ) || ' is not a reversal',
  'applying a reversal to an ordinary completion is refused'
);

-- A reason code is mandatory. Without one the audit trail would carry an unexplained
-- clawback.
--
-- The errcode is 22004 (invalid_parameter_value), not null_value_not_allowed:
-- `btrim('   ')` is an empty string, which is not NULL, and PostgreSQL rejects the
-- empty check that way. The message is the whole assertion here.
select throws_ok(
  $$
    select app_private.apply_provider_reversal(
      (select id from app.provider_conversions
       where provider_event_id = (select trans_id from rev_fixture) || ':-2'),
      '   '
    )
  $$,
  '22004',
  'apply_provider_reversal: a reason code is required',
  'a reversal with a blank reason code is refused'
);

-- And NULL is refused too, which is a different code path than the blank string.
--
-- Both report 22004. `null_value_not_allowed` is a CONDITION NAME that maps to
-- SQLSTATE 22004 (invalid_parameter_value), so it is not a distinct code from the blank
-- case above - and writing the name here would never match, because pgTAP compares
-- against the resolved SQLSTATE.
select throws_ok(
  $$
    select app_private.apply_provider_reversal(
      (select id from app.provider_conversions
       where provider_event_id = (select trans_id from rev_fixture) || ':-2'),
      null
    )
  $$,
  '22004',
  'apply_provider_reversal: a reason code is required',
  'a reversal with a null reason code is refused'
);

-- The completed reversal is recorded in the outbox, so an operator sees the withdrawal
-- even while no reward existed to move.
select results_eq(
  $$
    select count(*) from app.outbox_events
    where event_type = 'provider.reversal_no_reward'
      and aggregate_id = (
        select o.id::text from app.provider_conversions r
        join app.provider_conversions o on o.id = r.reverses_conversion_id
        where r.provider_event_id = (select trans_id from rev_fixture) || ':-2'
      )
  $$,
  $$ values (1::bigint) $$,
  'the applied reversal is written to the outbox for operator visibility'
);

-- No reward and no money. The whole point while the provider is CANDIDATE.
select results_eq(
  $$
    select count(*) from app.rewards r
    join app.provider_conversions c on c.reward_id = r.id
    where c.provider_event_id like 'pgtap-transaction-%'
       or c.provider_event_id like 'pgtap-transaction-%:-2'
  $$,
  $$ values (0::bigint) $$,
  'recording and applying a reversal creates no reward'
);

drop table rev_fixture;

select * from finish();
rollback;
