-- =============================================================================
-- pgTAP: Paid perk order creation (migration 043)
--
-- Spec: 83_MONETIZATION_PAID_PERKS.md (MODEL, ENTITLEMENT MODEL, REFUNDS),
--       71_ARCHITECTURAL_LAWS.md laws 42/43/44, 48_DATABASE_SCHEMA.txt.
--
-- The rule that matters: THE PRICE COMES FROM THE CATALOGUE. Every assertion here
-- is a variation on that. A purchase can never be cheap because a caller asked it
-- to be.
-- =============================================================================

begin;

-- 24 assertions, counted mechanically against this file (3 has_function,
-- 5 throws_ok, 15 is, 1 ok) rather than estimated. Earlier drafts declared 16, 22
-- and 25; each count was wrong because it was guessed instead of counted.
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'pgtap-buyer@example.invalid', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888',
   'authenticated', 'authenticated', 'pgtap-stranger@example.invalid', 'x', now(), now(), now());

-- Two products: one ACTIVE, one RETIRED. The retired one exists to prove the
-- catalogue and the order flow cannot disagree about what is buyable.
--
-- Unit is `NGN-kobo`, matching every other funding fixture in this suite. A product
-- priced in kobo cannot be paid from a `NGN` account, so the two must agree.
insert into app.paid_perk_products (code, kind, name, price_minor, unit, is_active)
values
  ('pgtap_perk_active', 'AD_FREE', 'pgTAP active perk', 250000::bigint, 'NGN-kobo', true),
  ('pgtap_perk_retired', 'AD_FREE', 'pgTAP retired perk', 100000::bigint, 'NGN-kobo', false)
on conflict (code) do nothing;

-- Fund the buyer with a deposit-shaped CREDIT. The deposit subsystem is not
-- invoked; the spend command only reads the ledger shape. Without this the purchase
-- raises `no user funding account for this user and unit`.
select ok(
  (app_private.post_ledger_entry(
    (select app_private.get_or_create_account(
      '77777777-7777-7777-7777-777777777777', 'USER_FUNDING', 'NGN-kobo')),
    'CREDIT', 1000000, 'NGN-kobo',
    'USER_FUNDING_DEPOSIT', 'pgtap_043_seed',
    'pgtap-043-seed-key', null, '{}'::jsonb
  )).id is not null,
  'the buyer is funded with a deposit-shaped credit'
);

-- The price the catalogue asserts. Referenced rather than repeated, so a change to
-- the fixture cannot silently make the assertions below vacuous.
create temporary table t_expected on commit drop as
  select p.price_minor, p.unit
  from app.paid_perk_products p where p.code = 'pgtap_perk_active';

-- ---------------------------------------------------------------------------
-- 1. Reachability through the exposed schema
-- ---------------------------------------------------------------------------

select has_function('public', 'create_paid_perk_order', array['uuid','text','text'],
  'the create_paid_perk_order entry point exists: PERK_PURCHASE had no writer');
select has_function('public', 'cancel_paid_perk_order', array['uuid','uuid'],
  'the cancel_paid_perk_order entry point exists');
select has_function('public', 'list_my_perk_orders', array['uuid','integer'],
  'the list_my_perk_orders read wrapper exists');

-- ---------------------------------------------------------------------------
-- 2. The order takes the CATALOGUE price
-- ---------------------------------------------------------------------------

select is(
  (select o.price_minor from app_private.create_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_product_code => 'pgtap_perk_active',
     p_idempotency_key => 'pgtap-043-order-1' ) o),
  (select price_minor from t_expected),
  'the order price is copied from the product catalogue, not from the caller'
);

select is(
  (select o.unit from app_private.create_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_product_code => 'pgtap_perk_active',
     p_idempotency_key => 'pgtap-043-order-2' ) o),
  (select unit from t_expected),
  'the order unit is copied from the product catalogue'
);

select is(
  (select o.status from app_private.create_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_product_code => 'pgtap_perk_active',
     p_idempotency_key => 'pgtap-043-order-3' ) o),
  'PENDING',
  'a new order is PENDING and unpaid: creating an order moves no money'
);

select is(
  (select count(*)::int from app.ledger_entries e
   join app.paid_perk_orders o on o.funding_spend_entry_id = e.id),
  0,
  'creating an order posts NO ledger entry'
);

-- ---------------------------------------------------------------------------
-- 3. Idempotency, and the catalog boundary
-- ---------------------------------------------------------------------------

select is(
  (select o.id from app_private.create_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_product_code => 'pgtap_perk_active',
     p_idempotency_key => 'pgtap-043-order-1' ) o),
  (select o.id from app.paid_perk_orders o where o.idempotency_key = 'pgtap-043-order-1'),
  'a retried create returns the ORIGINAL order rather than making a second one'
);

select is(
  (select count(*)::int from app.paid_perk_orders where idempotency_key = 'pgtap-043-order-1'),
  1,
  'a retried create does not duplicate the row'
);

select throws_ok(
  $$ select app_private.create_paid_perk_order(
       p_user_id => '77777777-7777-7777-7777-777777777777',
       p_product_code => 'pgtap_perk_retired',
       p_idempotency_key => 'pgtap-043-retired' ) $$,
  '23514',
  'create_paid_perk_order: product pgtap_perk_retired is not available',
  'a RETIRED product cannot be ordered'
);

select throws_ok(
  $$ select app_private.create_paid_perk_order(
       p_user_id => '77777777-7777-7777-7777-777777777777',
       p_product_code => 'no_such_perk_at_all',
       p_idempotency_key => 'pgtap-043-unknown' ) $$,
  'P0002',
  'create_paid_perk_order: unknown product',
  'an unknown product code is refused'
);

-- ---------------------------------------------------------------------------
-- 4. Ownership, and the refund-versus-cancel boundary
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select app_private.cancel_paid_perk_order(
       p_user_id => '88888888-8888-8888-8888-888888888888',
       p_order_id => (select id from app.paid_perk_orders
                      where idempotency_key = 'pgtap-043-order-1') ) $$,
  'P0002',
  'cancel_paid_perk_order: unknown order',
  'a stranger cannot cancel another user''s order'
);

select is(
  (select o.status from app_private.cancel_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_order_id => (select id from app.paid_perk_orders
                    where idempotency_key = 'pgtap-043-order-3') ) o),
  'CANCELLED',
  'the owner can cancel their own unpaid order'
);

-- A CANCELLED order must carry no ledger entry. This is the constraint that keeps
-- cancellation and refund from collapsing into each other.
select is(
  (select count(*)::int from app.paid_perk_orders
   where status = 'CANCELLED' and funding_spend_entry_id is not null),
  0,
  'a cancelled order never carries a spend entry'
);

-- Cancelling an already-cancelled order is idempotent, NOT the refund rule. The two
-- are different paths and the assertion for the refund case lives in section 5,
-- against an order that has actually been paid.
select is(
  (select o.status from app_private.cancel_paid_perk_order(
     p_user_id => '77777777-7777-7777-7777-777777777777',
     p_order_id => (select id from app.paid_perk_orders
                    where idempotency_key = 'pgtap-043-order-3') ) o),
  'CANCELLED',
  'cancelling an already-cancelled order is idempotent, not an error'
);

-- ---------------------------------------------------------------------------
-- 5. The purchase path is now REACHABLE end to end
-- ---------------------------------------------------------------------------

-- The whole point of migration 043. Before it, this raised `unknown order`.
--
-- The purchase is PERFORMED in its own statement and READ in the next. This is
-- the Q-36 snapshot trap again: `purchase_with_funding` inserts the spend event and
-- updates the order, and an outer join in the same statement cannot see either, so the
-- first draft returned NULL while looking like a real result.
create temporary table t_purchase on commit drop as
  select * from app_private.purchase_with_funding(
    p_user_id => '77777777-7777-7777-7777-777777777777',
    p_purpose => 'PERK_PURCHASE',
    p_amount_minor => (select price_minor from t_expected),
    p_unit => (select unit from t_expected),
    p_idempotency_key => 'pgtap-043-purchase',
    p_order_id => (select id from app.paid_perk_orders
                   where idempotency_key = 'pgtap-043-order-1') );

select is(
  (select o.status from app.paid_perk_orders o
   where o.id = (select order_id from t_purchase)),
  'FULFILLED',
  'a created order can now be PAID: PERK_PURCHASE is no longer dead code'
);

-- A FULFILLED order cannot be cancelled - it must be refunded, because cancelling a
-- paid order would hide a real debit. This is the assertion that was previously
-- aimed at an unpaid order, where it was testing the wrong rule entirely.
select throws_ok(
  $$ select app_private.cancel_paid_perk_order(
       p_user_id => '77777777-7777-7777-7777-777777777777',
       p_order_id => (select id from app.paid_perk_orders
                      where idempotency_key = 'pgtap-043-order-1') ) $$,
  '23514',
  'cancel_paid_perk_order: a paid order cannot be cancelled, it must be refunded',
  'a FULFILLED order cannot be cancelled: refund and cancel are different paths'
);

-- LAW 47 SEPARATION, proven end to end rather than by inspection: the spend posts
-- against USER_FUNDING and never against EARNED_REWARD.
select is(
  (select la.domain::text from app.funding_spend_events fse
   join app.ledger_entries le on le.id = fse.ledger_entry_id
   join app.ledger_accounts la on la.id = le.account_id
   where fse.idempotency_key = 'pgtap-043-purchase'),
  'USER_FUNDING',
  'a perk purchase debits USER_FUNDING, never EARNED_REWARD (law 47 separation)'
);

select is(
  (select le.direction::text from app.funding_spend_events fse
   join app.ledger_entries le on le.id = fse.ledger_entry_id
   where fse.idempotency_key = 'pgtap-043-purchase'),
  'DEBIT',
  'the funding spend posts a DEBIT'
);

select is(
  (select e.status from app.paid_entitlements e
   join app.paid_perk_products p on p.id = e.product_id
   where e.user_id = '77777777-7777-7777-7777-777777777777'
     and p.code = 'pgtap_perk_active'),
  'ACTIVE',
  'paying creates the ACTIVE entitlement the purchase was for'
);

-- A second purchase is refused BEFORE any write, so it leaves no ledger entry.
select throws_ok(
  $$ select app_private.create_paid_perk_order(
       p_user_id => '77777777-7777-7777-7777-777777777777',
       p_product_code => 'pgtap_perk_active',
       p_idempotency_key => 'pgtap-043-double' ) $$,
  '23514',
  'create_paid_perk_order: you already own this perk',
  'a duplicate purchase is refused rather than double-charged'
);

select is(
  (select count(*)::int from app.funding_spend_events where idempotency_key = 'pgtap-043-purchase'),
  1,
  'exactly one funding spend exists for the purchase'
);

-- ---------------------------------------------------------------------------
-- 6. Law 47 by absence: these commands cannot reach a reward path
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname in ('create_paid_perk_order','cancel_paid_perk_order')
     and (
       p.prosrc like '%grant_reward%'
       or p.prosrc like '%REWARD_EARNED%'
       or p.prosrc like '%post_ledger_entry%'
       or p.prosrc like '%create_withdrawal_request%'
       or p.prosrc like '%earned_reward%'
     )),
  0,
  'LAW 47: neither order command can reach a reward or withdrawal primitive'
);

select * from finish();

rollback;
