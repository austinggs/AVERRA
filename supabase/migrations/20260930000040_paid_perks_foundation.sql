-- =============================================================================
-- Averra migration 040: Paid perks, entitlements and donations foundation
--
-- Source of truth: 83_MONETIZATION_PAID_PERKS.md, 48_DATABASE_SCHEMA.txt,
--   36_WALLET_LEDGER.txt (FUNDING SPEND, USER_FUNDING_SPEND),
--   74_FINANCIAL_FLOW_MAP.md (FUNDING SPEND),
--   75_GAME_ECONOMY_FLOW.md (USER FUNDING INTEGRATION, ISOLATION),
--   71_ARCHITECTURAL_LAWS.md laws 42, 43, 54, 56
--
-- THE BOUNDARIES THIS MIGRATION ENFORCES, STRUCTURALLY
--
-- Law 43 / law 56: spending User Funding Balance never creates earned cash
-- liability. NOTHING here references app.rewards, app.reward_sources,
-- app.withdrawal_requests, or the EARNED_REWARD domain. The only financial
-- writer is migration 041's purchase command, which posts a USER_FUNDING_SPEND
-- DEBIT against the USER_FUNDING account. A DEBIT can only reduce a funding
-- balance; it cannot credit an earned balance.
--
-- Doc 83 STRICT BOUNDARY: perks are ENTITLEMENTS, not ledger entries. There is
-- no amount column on any perk table, so a price can never be confused with a
-- payout and a perk can never name a reward.
--
-- Doc 83 DONATIONS: the donations table has NO FK to ledger_accounts, rewards,
-- withdrawals, entitlements, or perks, and no function in migration 041 posts a
-- ledger entry for recording a donation. A funding-sourced donation is a
-- separate audited funding-spend event pointing AT the donation.
--
-- Doc 83 REFUNDS: paid_entitlements carries its own lifecycle (ACTIVE, REVOKED,
-- EXPIRED, CANCELLED); refunds adjust the entitlement plus a compensating
-- funding CREDIT, never an edit of the original spend.
-- =============================================================================

-- Doc 83 PAID PERKS plus the subscription lifecycle doc 83 SUBSCRIPTIONS
-- requires (status, billing period, start/end, cancellation, refund state).
create type app.paid_perk_kind as enum (
  'AD_FREE',
  'PRIORITY_SUPPORT',
  'THEME',
  'GAME_COSMETIC',
  'CONVENIENCE',
  'STATS_HISTORY'
);

-- One row per purchase attempt. A refund does not reopen the order; it revokes
-- the entitlement (doc 83 REFUNDS).
create type app.paid_order_status as enum (
  'PENDING',
  'CONFIRMED',
  'FULFILLED',
  'REFUNDED',
  'CANCELLED'
);

-- What the user owns. Server-authoritative, independent of the reward ledger
-- (doc 83 ENTITLEMENT MODEL).
create type app.paid_entitlement_status as enum (
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
  'CANCELLED'
);

-- Funding-spend purpose. GAME_PURCHASE is the doc 75 bridge; PERK_PURCHASE is
-- the doc 83 path; DONATION_FROM_FUNDING is the audited debit behind a
-- funding-sourced donation.
create type app.funding_spend_purpose as enum (
  'GAME_PURCHASE',
  'PERK_PURCHASE',
  'DONATION_FROM_FUNDING'
);
-- The catalogue. Configuration, not user state. Prices are in minor units of
-- the funding unit. A product has a price; it never has a payout.
create table app.paid_perk_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind app.paid_perk_kind not null,
  name text not null,
  description text,
  price_minor bigint not null,
  unit text not null,
  -- Null billing_period means one-time / perpetual until revoked or expired
  -- by duration below.
  billing_period text,
  duration_seconds bigint,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paid_perk_products_code_unique unique (code),
  constraint paid_perk_products_code_shape check (code ~ '^[a-z0-9_]{2,60}$'),
  constraint paid_perk_products_price_positive check (price_minor > 0),
  constraint paid_perk_products_billing_shape check (
    billing_period is null or billing_period in ('ONE_TIME','MONTHLY','YEARLY')
  ),
  constraint paid_perk_products_duration_non_negative check (
    duration_seconds is null or duration_seconds >= 0
  )
);

create trigger trg_paid_perk_products_updated_at
  before update on app.paid_perk_products
  for each row execute function app_private.set_updated_at();

comment on table app.paid_perk_products is
  'Doc 83 catalogue: named non-financial benefits with prices. No amount here is a payout; perks never reference rewards, budgets or the ledger.';

-- One row per purchase attempt. Idempotent on idempotency_key so a
-- double-click or retried request cannot buy twice.
create table app.paid_perk_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references app.paid_perk_products(id) on delete restrict,
  status app.paid_order_status not null default 'PENDING',
  price_minor bigint not null,
  unit text not null,
  -- The funding-spend ledger entry that paid for this order. Null until the
  -- spend command posts it; one order pays exactly once.
  funding_spend_entry_id bigint references app.ledger_entries(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  refunded_at timestamptz,
  constraint paid_perk_orders_price_positive check (price_minor > 0),
  constraint paid_perk_orders_idempotency_unique unique (idempotency_key),
  constraint paid_perk_orders_refund_needs_fulfilment check (
    status <> 'REFUNDED' or fulfilled_at is not null
  ),
  constraint paid_perk_orders_cancelled_has_no_spend check (
    status <> 'CANCELLED' or funding_spend_entry_id is null
  )
);

create trigger trg_paid_perk_orders_updated_at
  before update on app.paid_perk_orders
  for each row execute function app_private.set_updated_at();

create index idx_paid_perk_orders_user on app.paid_perk_orders(user_id, created_at desc);
create index idx_paid_perk_orders_status on app.paid_perk_orders(status, created_at)
  where status in ('PENDING','CONFIRMED');

comment on table app.paid_perk_orders is
  'Doc 83 purchase attempts. Payment is a USER_FUNDING_SPEND debit (migration 041); the order itself moves no money.';
-- What the user owns. One ACTIVE entitlement per (user, product): buying twice
-- renews or is refused, never duplicates.
create table app.paid_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references app.paid_perk_products(id) on delete restrict,
  order_id uuid not null references app.paid_perk_orders(id) on delete restrict,
  status app.paid_entitlement_status not null default 'ACTIVE',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paid_entitlements_revoke_needs_reason check (
    status <> 'REVOKED' or (revoked_at is not null and revoke_reason is not null
      and length(btrim(revoke_reason)) > 0)
  ),
  constraint paid_entitlements_window check (
    ends_at is null or starts_at is null or ends_at > starts_at
  )
);

-- One ACTIVE entitlement per order, full stop. One row per order means a
-- retried grant can never mint a second entitlement, and (user, product)
-- can go ACTIVE again after a refund without tripping a stale uniqueness
-- row. Preventing two ACTIVE rows for the same PRODUCT is a purchase-time
-- check in purchase_with_funding (refused BEFORE the debit), not a
-- constraint here: a constraint would fire AFTER the debit was posted and
-- leave a paid-for order with no entitlement.
create unique index uq_paid_entitlements_order_active
  on app.paid_entitlements (order_id)
  where status = 'ACTIVE';

create trigger trg_paid_entitlements_updated_at
  before update on app.paid_entitlements
  for each row execute function app_private.set_updated_at();

create index idx_paid_entitlements_user on app.paid_entitlements(user_id, status);

comment on table app.paid_entitlements is
  'Doc 83 ENTITLEMENT MODEL: server-authoritative non-financial benefits, independent of the reward ledger. A row here never implies a balance.';

-- Voluntary support. Deliberately disconnected from money state: no ledger FK,
-- no reward FK, no entitlement FK. Recording a donation creates
-- acknowledgement, never a balance. A funding-sourced donation is a
-- funding_spend_events row pointing AT the donation, not a column on it.
create table app.donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_minor bigint not null,
  unit text not null,
  funding_source text not null default 'EXTERNAL_MINIPAY',
  status text not null default 'RECORDED',
  idempotency_key text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint donations_amount_positive check (amount_minor > 0),
  constraint donations_idempotency_unique unique (idempotency_key),
  constraint donations_funding_source_check check (
    funding_source in ('EXTERNAL_MINIPAY','EXTERNAL_CASH_LINK','EXTERNAL_DAIMO','USER_FUNDING')
  ),
  constraint donations_status_check check (
    status in ('RECORDED','ACKNOWLEDGED','REFUNDED')
  )
);

create index idx_donations_user on app.donations(user_id, created_at desc);

comment on table app.donations is
  'Doc 83 DONATIONS: voluntary support. Creates no balance, reward, withdrawal entitlement, or return expectation. No FK to any financial table, by design.';
-- The audit trail of every USER_FUNDING debit. Each row pairs exactly one
-- ledger entry (the DEBIT migration 041 posts) with exactly one purpose and
-- one target. The ledger entry is the money; this row is the explanation.
-- Refunds are NEW rows with is_refund = true pointing at the original spend,
-- never edits (doc 75 REFUND / REVERSAL).
create table app.funding_spend_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  purpose app.funding_spend_purpose not null,
  -- Exactly one target, enforced below: a game purchase names a game
  -- upgrade/machine code, a perk purchase names an order, a funding-sourced
  -- donation names a donation.
  game_target_code text,
  order_id uuid references app.paid_perk_orders(id) on delete restrict,
  donation_id uuid references app.donations(id) on delete restrict,
  amount_minor bigint not null,
  unit text not null,
  ledger_entry_id bigint not null references app.ledger_entries(id) on delete restrict,
  idempotency_key text not null,
  is_refund boolean not null default false,
  refund_of uuid references app.funding_spend_events(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  constraint funding_spend_events_amount_positive check (amount_minor > 0),
  constraint funding_spend_events_idempotency_unique unique (idempotency_key),
  constraint funding_spend_events_single_target check (
    num_nonnulls(game_target_code, order_id::text, donation_id::text) = 1
  ),
  constraint funding_spend_events_purpose_matches_target check (
    (purpose = 'GAME_PURCHASE' and game_target_code is not null)
    or (purpose = 'PERK_PURCHASE' and order_id is not null)
    or (purpose = 'DONATION_FROM_FUNDING' and donation_id is not null)
  ),
  constraint funding_spend_events_refund_needs_original check (
    (not is_refund and refund_of is null)
    or (is_refund and refund_of is not null and refund_of <> id)
  )
);

create index idx_funding_spend_events_user on app.funding_spend_events(user_id, created_at desc);
create index idx_funding_spend_events_ledger on app.funding_spend_events(ledger_entry_id);
create index idx_funding_spend_events_order on app.funding_spend_events(order_id)
  where order_id is not null;

comment on table app.funding_spend_events is
  'Audit trail pairing each USER_FUNDING_SPEND debit with its purpose and target. Refunds are new rows (is_refund), never edits.';

-- RLS enabled on every table as defence in depth; nothing granted to anon or
-- authenticated. Reads go through named public wrappers (migration 041);
-- writes go through app_private commands. The app schema is not exposed
-- through the Data API at all.
alter table app.paid_perk_products enable row level security;
alter table app.paid_perk_orders enable row level security;
alter table app.paid_entitlements enable row level security;
alter table app.donations enable row level security;
alter table app.funding_spend_events enable row level security;

revoke all on table app.paid_perk_products, app.paid_perk_orders,
  app.paid_entitlements, app.donations, app.funding_spend_events
  from anon, authenticated;

grant all on table app.paid_perk_products, app.paid_perk_orders,
  app.paid_entitlements, app.donations, app.funding_spend_events
  to service_role;
