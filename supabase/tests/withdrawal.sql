-- =============================================================================
-- pgTAP: withdrawal invariants
--
-- Spec: 37_WITHDRAWAL_SYSTEM.txt, 83_MONETIZATION_PAID_PERKS.md,
--       71_ARCHITECTURAL_LAWS.md laws 14/22/23/28/40/45, 48_DATABASE_SCHEMA.txt
--
-- These assert the constraints and command functions actually hold at the
-- database level. The TypeScript unit tests mirror the pure arithmetic; only
-- these can prove the real enforcement.
-- =============================================================================

begin;

select plan(21);

-- ---------------------------------------------------------------------------
-- Structural guarantees
-- ---------------------------------------------------------------------------
select has_table('app', 'withdrawal_requests', 'withdrawal requests table exists');
select has_table('app', 'payment_operations', 'payment operations table exists');
select has_table('app', 'payout_destinations', 'payout destinations table exists');
select has_table('app', 'fee_records', 'fee records table exists');
select has_table('app', 'minipay_destination_verifications', 'MiniPay destination verifications exist');

-- ---------------------------------------------------------------------------
-- RLS lockdown: no browser-facing access to money
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app' and tablename in (
      'withdrawal_requests','payment_operations','payout_destinations',
      'fee_records','cash_link_operations','reconciliation_records'
    ) and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every withdrawal table'
);

select results_eq(
  $$
    select count(*) from pg_policies
    where schemaname = 'app' and tablename = 'withdrawal_requests'
  $$,
  $$ values (0::bigint) $$,
  'no permissive RLS policy exposes withdrawal requests; access is server-side only'
);

-- ---------------------------------------------------------------------------
-- The gross/fee/net invariant is a DATABASE constraint, not a convention.
-- ---------------------------------------------------------------------------
-- pgTAP's throws_ok compares the expected message with SQLERRM by EXACT equality,
-- not as a pattern, so the expectation is the whole message PostgreSQL raises.
-- The constraint name inside it is what proves WHICH rule fired.
--
-- 23514, not 23505: withdrawal_requests_split_exact is a CHECK constraint, so a
-- violation is a check_violation. 23505 is unique_violation, which this statement
-- could never raise. A CHECK is evaluated while the row is inserted, before its
-- foreign keys are checked, so the random ids below never reach their FK and the
-- split rule is the failure the test actually observes.
select throws_ok(
  $$
    insert into app.withdrawal_requests (
      user_id, method, status, destination_id, unit,
      gross_amount_minor, fee_amount_minor, net_amount_minor
    )
    select u.id, 'MINIPAY_MANUAL', 'REQUESTED', d.id, 'NGN', 1000, 150, 900
    from (select gen_random_uuid() as id) u
    cross join (select gen_random_uuid() as id) d
  $$,
  '23514',
  'new row for relation "withdrawal_requests" violates check constraint "withdrawal_requests_split_exact"',
  'a withdrawal whose fee plus net does not equal gross is rejected'
);

select throws_ok(
  $$
    insert into app.withdrawal_requests (
      user_id, method, status, destination_id, unit,
      gross_amount_minor, fee_amount_minor, net_amount_minor
    )
    select u.id, 'MINIPAY_MANUAL', 'REQUESTED', d.id, 'NGN', 1000, 0, 1001
    from (select gen_random_uuid() as id) u
    cross join (select gen_random_uuid() as id) d
  $$,
  '23514',
  'new row for relation "withdrawal_requests" violates check constraint "withdrawal_requests_split_exact"',
  'a withdrawal that pays out more than the gross is rejected'
);

select throws_ok(
  $$
    insert into app.payment_operations (withdrawal_id, method, execution_mode, provider)
    values (gen_random_uuid(), 'MINIPAY_MANUAL', 'AUTOMATIC_ADAPTER', 'DAIMO')
  $$,
  '23514',
  'new row for relation "payment_operations" violates check constraint "payment_operations_mode_matches_method"',
  'an automatic adapter cannot be attached to a manual method'
);

select throws_ok(
  $$
    insert into app.payment_operations (withdrawal_id, method, execution_mode)
    values (gen_random_uuid(), 'MINIPAY_MANUAL', 'MANUAL_OPERATOR')
  $$,
  '23514',
  'new row for relation "payment_operations" violates check constraint "payment_operations_attribution_check"',
  'a manual payment operation must name the operator who performed it'
);

select throws_ok(
  $$
    insert into app.payment_operations (withdrawal_id, method, execution_mode, operator_id)
    values (gen_random_uuid(), 'CRYPTO_AUTOMATIC_DAIMO', 'MANUAL_OPERATOR', gen_random_uuid())
  $$,
  '23514',
  'new row for relation "payment_operations" violates check constraint "payment_operations_mode_matches_method"',
  'a manual operator cannot be attached to an automatic method'
);

-- ---------------------------------------------------------------------------
-- Payout destinations: verification is an explicit human act.
-- ---------------------------------------------------------------------------
-- account_identifier is NOT NULL, and NOT NULL is enforced BEFORE check
-- constraints, so the original fixture died on 23502 and never reached
-- payout_destinations_method_check. Supplying the identifier lets the method check
-- be the failure this test actually observes.
select throws_ok(
  $$
    insert into app.payout_destinations (user_id, method, account_identifier, status)
    values (gen_random_uuid(), 'PAYPAL', 'fixture', 'VERIFIED')
  $$,
  '23514',
  'new row for relation "payout_destinations" violates check constraint "payout_destinations_method_check"',
  'an unrecognised payout method is rejected'
);

select results_eq(
  $$
    select count(*) from app.payout_destinations where status = 'VERIFIED'
  $$,
  $$ values (0::bigint) $$,
  'no destination is verified by default'
);

-- ---------------------------------------------------------------------------
-- Privileged functions are not callable by a browser-facing role (law 44).
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('create_withdrawal_request','settle_withdrawal','release_withdrawal')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  $$,
  $$ values (0::bigint) $$,
  'the anon role cannot execute any withdrawal money-moving function'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('create_withdrawal_request','settle_withdrawal','release_withdrawal')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  $$ values (0::bigint) $$,
  'the authenticated role cannot execute any withdrawal money-moving function'
);

-- ---------------------------------------------------------------------------
-- The fee calculation matches the published 15% exactly, rounding down.
-- ---------------------------------------------------------------------------
select is(
  app_private.calculate_fee_minor(1000, 1500),
  150::bigint,
  '1000 gross yields a 150 fee (the doc 83 worked example)'
);

select is(
  app_private.calculate_fee_minor(999, 1500),
  149::bigint,
  'the fee is rounded down, never up, so rounding cannot overcharge'
);

select is(
  1000::bigint - app_private.calculate_fee_minor(1000, 1500),
  850::bigint,
  'net payout is gross minus fee'
);

select throws_ok(
  $$ select app_private.calculate_fee_minor(-1, 1500) $$,
  '23514',
  null,
  'a negative gross amount is rejected by the fee calculation'
);

-- Restored. This block had been appended AFTER `rollback;`, where it is not valid
-- SQL: the file ended in a syntax error and this suite had never run. It asserts a
-- real invariant (a zero-amount withdrawal is refused by
-- withdrawal_requests_gross_positive), so it is kept as the plan's final
-- assertion rather than deleted, which is why the plan moved from 20 to 21.
select throws_ok(
  $$
    insert into app.withdrawal_requests (
      user_id, method, status, destination_id, unit,
      gross_amount_minor, fee_amount_minor, net_amount_minor
    )
    select u.id, 'MINIPAY_MANUAL', 'REQUESTED', d.id, 'NGN', 0, 0, 0
    from (select gen_random_uuid() as id) u
    cross join (select gen_random_uuid() as id) d
  $$,
  '23514',
  'new row for relation "withdrawal_requests" violates check constraint "withdrawal_requests_gross_positive"',
  'a zero-amount withdrawal is rejected'
);

select * from finish();
rollback;

