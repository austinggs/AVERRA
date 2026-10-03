-- =============================================================================
-- pgTAP: Paid perks, donations and the funding-spend path
--
-- Spec: 83_MONETIZATION_PAID_PERKS.md, 75_GAME_ECONOMY_FLOW.md,
--       36_WALLET_LEDGER.txt, 71_ARCHITECTURAL_LAWS.md laws 42, 43, 54, 56.
--
-- The assertions that matter most prove a purchase CANNOT become an earned
-- reward and a donation CANNOT become a balance. Both are expressed
-- structurally, so they hold even if a later route forgets to check.
-- =============================================================================

begin;
select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures. Every NOT NULL column is supplied, so the constraint under test
-- is the one that fires rather than an unrelated NOT NULL.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pgtap_buyer@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pgtap_other@example.invalid', 'x', now(), now(), now());

-- The five tables doc 48 names for this subsystem.
select has_table('app', 'paid_perk_products', 'paid_perk_products table exists');
select has_table('app', 'paid_perk_orders', 'paid_perk_orders table exists');
select has_table('app', 'paid_entitlements', 'paid_entitlements table exists');
select has_table('app', 'donations', 'donations table exists');
select has_table('app', 'funding_spend_events', 'funding_spend_events table exists');

-- The commands must be reachable through the exposed schema, which migration
-- 035 established is the only way PostgREST can resolve an RPC at all.
select has_function(
  'public', 'purchase_with_funding',
  array['uuid','app.funding_spend_purpose','bigint','text','text','text','uuid','uuid','uuid'],
  'the purchase_with_funding entry point exists'
);
select has_function(
  'public', 'record_donation',
  array['uuid','bigint','text','text','text','text'],
  'the record_donation entry point exists'
);
select has_function(
  'public', 'refund_funding_spend',
  array['uuid','uuid','text','text','uuid'],
  'the refund_funding_spend entry point exists'
);

-- Doc 75 ISOLATION, asserted structurally: no perks/donations/spend table
-- carries a foreign key to a financial reward, budget, withdrawal, or earned
-- account table.
select results_eq(
  $$
    select count(*) from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.table_schema = 'app'
      and tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name in (
        'paid_perk_products','paid_perk_orders','paid_entitlements',
        'donations','funding_spend_events'
      )
      and ccu.table_name in (
        'rewards','reward_sources','reward_caps','withdrawal_requests',
        'fee_records'
      )
  $$,
  $$ values (0::bigint) $$,
  'no perks/donations/spend table references a reward, budget, withdrawal or fee table'
);
-- Doc 83 DONATIONS, asserted structurally: the donations table has no FK to
-- any ledger, reward, withdrawal, entitlement, perk, or spend table. A
-- donation record is acknowledgement only.
select results_eq(
  $$
    select count(*) from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.table_schema = 'app'
      and tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name = 'donations'
      and ccu.table_name in (
        'ledger_accounts','ledger_entries','rewards','withdrawal_requests',
        'paid_entitlements','paid_perk_orders','funding_spend_events'
      )
  $$,
  $$ values (0::bigint) $$,
  'donations has no FK to any ledger, reward, withdrawal, entitlement, order or spend table'
);

-- Law 43, asserted against the function bodies: purchase and refund are the
-- ONLY functions in this subsystem that may call post_ledger_entry, and
-- record_donation must never call it.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('record_donation')
      and p.prosrc ~ '(post_ledger_entry|grant_reward|transition_reward|reverse_reward|create_withdrawal_request)'
  $$,
  $$ values (0::bigint) $$,
  'record_donation cannot reach any money primitive'
);

-- Anchor comment explaining the shape assertions below. Kept separate so the
-- assertions themselves stay machine-readable.
select ok(
  (select p.prosrc from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'post_funding_spend_debit')
    ~ 'USER_FUNDING_SPEND',
  'the funding-spend debit posts source_type USER_FUNDING_SPEND'
);

-- The helper comment repeats both words ("Never REWARD_EARNED, never
-- EARNED_REWARD"), so negative matches anchor on the QUOTED call shape:
-- the helper must pass the USER_FUNDING domain argument, and must never
-- pass a REWARD_EARNED source argument.
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'post_funding_spend_debit'
      and p.prosrc ~ '''USER_FUNDING'''
  $$,
  $$ values (1::bigint) $$,
  'the funding-spend debit operates on the USER_FUNDING domain'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'post_funding_spend_debit'
      and p.prosrc ~ '''REWARD_EARNED'''
  $$,
  $$ values (0::bigint) $$,
  'the funding-spend debit never posts a REWARD_EARNED entry'
);

-- ===========================================================================
-- Behaviour: catalogue, purchase, donation, refund.
-- ===========================================================================

insert into app.paid_perk_products (
  code, kind, name, price_minor, unit, billing_period, is_active
) values (
  'pgtap_adfree', 'AD_FREE', 'Pgtap Ad-Free', 5000, 'NGN-kobo', 'ONE_TIME', true
);

select is(
  (select count(*) from public.list_perk_products(
    '11111111-1111-1111-1111-111111111111', 50)),
  1::bigint,
  'the active product is listed'
);

-- A free product cannot exist: price must be positive.
select throws_ok(
  $$
    insert into app.paid_perk_products (
      code, kind, name, price_minor, unit, is_active
    ) values (
      'pgtap_free', 'THEME', 'Pgtap Free', 0, 'NGN-kobo', true
    )
  $$,
  '23514',
  'new row for relation "paid_perk_products" violates check constraint "paid_perk_products_price_positive"',
  'a zero-price perk product is refused'
);

-- Fund the buyer: a USER_FUNDING account with a confirmed-deposit-shaped
-- credit. The deposit subsystem is not invoked; the ledger shape is what the
-- spend command reads.
select ok(
  app_private.get_or_create_account(
    '11111111-1111-1111-1111-111111111111', 'USER_FUNDING', 'NGN-kobo'
  ) = app_private.get_or_create_account(
    '11111111-1111-1111-1111-111111111111', 'USER_FUNDING', 'NGN-kobo'
  ),
  'the funding account lookup is idempotent'
);

select ok(
  (app_private.post_ledger_entry(
    (select app_private.get_or_create_account(
      '11111111-1111-1111-1111-111111111111', 'USER_FUNDING', 'NGN-kobo')),
    'CREDIT', 20000, 'NGN-kobo',
    'USER_FUNDING_DEPOSIT', 'pgtap_seed-deposit',
    'pgtap_seed-deposit-key', null, '{}'::jsonb
  )).id is not null,
  'the buyer is funded with a deposit-shaped credit'
);
insert into app.paid_perk_orders (
  user_id, product_id, price_minor, unit, idempotency_key
) values (
  '11111111-1111-1111-1111-111111111111',
  (select id from app.paid_perk_products where code = 'pgtap_adfree'),
  5000, 'NGN-kobo', 'pgtap_order-1'
);

-- A full perk purchase: debit plus entitlement in one transaction.
select is(
  (select s.purpose from app_private.purchase_with_funding(
    '11111111-1111-1111-1111-111111111111', 'PERK_PURCHASE',
    5000, 'NGN-kobo', 'pgtap_spend-1', null,
    (select id from app.paid_perk_orders where idempotency_key = 'pgtap_order-1'),
    null
  ) s),
  'PERK_PURCHASE',
  'a perk purchase posts a funding-spend event'
);

select is(
  (select status from app.paid_perk_orders where idempotency_key = 'pgtap_order-1'),
  'FULFILLED',
  'the order is fulfilled'
);

select is(
  (select count(*) from app.paid_entitlements
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'ACTIVE'),
  1::bigint,
  'the buyer holds one active entitlement'
);

select is(
  (select e.source_type::text from app.ledger_entries e
   join app.funding_spend_events s on s.ledger_entry_id = e.id
   where s.idempotency_key = 'pgtap_spend-1'),
  'USER_FUNDING_SPEND',
  'the debit is source-typed USER_FUNDING_SPEND'
);

select is(
  (select e.direction::text from app.ledger_entries e
   join app.funding_spend_events s on s.ledger_entry_id = e.id
   where s.idempotency_key = 'pgtap_spend-1'),
  'DEBIT',
  'the spend is a DEBIT, never a credit'
);

-- Idempotent replay: the same key returns the same spend, granting nothing.
select is(
  (select s.id from app_private.purchase_with_funding(
    '11111111-1111-1111-1111-111111111111', 'PERK_PURCHASE',
    5000, 'NGN-kobo', 'pgtap_spend-1', null,
    (select id from app.paid_perk_orders where idempotency_key = 'pgtap_order-1'),
    null
  ) s),
  (select s.id from app.funding_spend_events s where s.idempotency_key = 'pgtap_spend-1'),
  'a retried purchase returns the existing spend event'
);

-- A second order for the same product is refused BEFORE any debit: the buyer
-- already holds an active entitlement.
insert into app.paid_perk_orders (
  user_id, product_id, price_minor, unit, idempotency_key
) values (
  '11111111-1111-1111-1111-111111111111',
  (select id from app.paid_perk_products where code = 'pgtap_adfree'),
  5000, 'NGN-kobo', 'pgtap_order-2'
);

select throws_ok(
  $$
    select app_private.purchase_with_funding(
      '11111111-1111-1111-1111-111111111111', 'PERK_PURCHASE',
      5000, 'NGN-kobo', 'pgtap_spend-2', null,
      (select id from app.paid_perk_orders where idempotency_key = 'pgtap_order-2'),
      null
    )
  $$,
  '23514',
  'purchase_with_funding: an active entitlement for this product already exists',
  'a duplicate perk purchase is refused without moving money'
);

-- Another user's order cannot be paid with this user's funding.
insert into app.paid_perk_orders (
  user_id, product_id, price_minor, unit, idempotency_key
) values (
  '22222222-2222-2222-2222-222222222222',
  (select id from app.paid_perk_products where code = 'pgtap_adfree'),
  5000, 'NGN-kobo', 'pgtap_order-3'
);

select throws_ok(
  $$
    select app_private.purchase_with_funding(
      '11111111-1111-1111-1111-111111111111', 'PERK_PURCHASE',
      5000, 'NGN-kobo', 'pgtap_spend-3', null,
      (select id from app.paid_perk_orders where idempotency_key = 'pgtap_order-3'),
      null
    )
  $$,
  '23503',
  'purchase_with_funding: order does not belong to this user',
  'a user cannot pay for another user order'
);

-- A donation records acknowledgement and posts NO ledger entry.
select is(
  (select d.status from app_private.record_donation(
    '11111111-1111-1111-1111-111111111111', 1000, 'NGN-kobo',
    'EXTERNAL_MINIPAY', 'pgtap_donation-1', 'keep building'
  ) d),
  'RECORDED',
  'a donation is recorded'
);

select is(
  (select count(*) from app.ledger_entries e
   where e.idempotency_key like 'pgtap_donation%'),
  0::bigint,
  'recording a donation posts no ledger entry'
);

-- A refund is a NEW compensating event: the original debit untouched, the
-- entitlement revoked, the order marked REFUNDED.
select is(
  (select s.is_refund from app_private.refund_funding_spend(
    (select id from app.funding_spend_events where idempotency_key = 'pgtap_spend-1'),
    '22222222-2222-2222-2222-222222222222',
    'pgtap refund reason', 'pgtap_refund-1'
  ) s),
  true,
  'a refund returns a new refund-marked spend event'
);

select is(
  (select status from app.paid_entitlements
   where order_id = (select id from app.paid_perk_orders where idempotency_key = 'pgtap_order-1')
   order by created_at desc limit 1),
  'REVOKED',
  'the refunded entitlement is revoked'
);

select is(
  (select count(*) from app.funding_spend_events
   where refund_of = (select id from app.funding_spend_events where idempotency_key = 'pgtap_spend-1')),
  1::bigint,
  'the refund points at the original spend'
);

select is(
  (select e.direction::text from app.ledger_entries e
   join app.funding_spend_events s on s.ledger_entry_id = e.id
   where s.idempotency_key = 'pgtap_refund-1'),
  'CREDIT',
  'the refund posts a compensating CREDIT'
);

-- The grants population is enumerated first and only then filtered, per the
-- lesson in AGENTS.md: a check that names one function reports 0 bad whether or
-- not the other five are also open. This subsystem adds SIX public functions,
-- and any one of them would be an unauthenticated money path.
select is(
  (select count(*)::bigint from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'list_perk_products', 'list_my_entitlements', 'list_my_funding_spends',
       'purchase_with_funding', 'record_donation', 'refund_funding_spend'
     )),
  6::bigint,
  'the grants population is six public functions, so the checks below see them all'
);

-- Migration 036 exists because 29 wrappers shipped without the revoke (Q-22),
-- and a grant to service_role does not remove the PUBLIC default.
select is(
  (select count(*)::bigint from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'list_perk_products', 'list_my_entitlements', 'list_my_funding_spends',
       'purchase_with_funding', 'record_donation', 'refund_funding_spend'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint,
  'no public function in this subsystem is executable by an unauthenticated caller'
);

select is(
  (select count(*)::bigint from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'list_perk_products', 'list_my_entitlements', 'list_my_funding_spends',
       'purchase_with_funding', 'record_donation', 'refund_funding_spend'
     )
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0::bigint,
  'no public function in this subsystem is executable by a browser session role'
);

select * from finish();

rollback;
