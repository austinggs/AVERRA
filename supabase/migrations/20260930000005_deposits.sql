-- =============================================================================
-- Averra migration 005: User funding / deposit subsystem
--
-- Source of truth: 38_PAYMENT_OPERATIONS.txt, 84_USER_FUNDING_DEPOSIT_SYSTEM.md,
--                  48_DATABASE_SCHEMA.txt, 56_FINANCIAL_CONTROLS.txt,
--                  docs/adr/0004-token-candidacy-tiers.md, 0005-deposit-limit-valuation.md
--
-- Enforced here:
--  * law 47/48 - Celo only; only the allowlisted tokens; native CELO never accepted
--  * law 49    - an unsupported token/network is NEVER automatically credited
--  * law 50    - a screenshot or a copied link is never settlement proof
--  * law 51    - the same verified transfer EVENT can be credited at most once
--  * law 53    - expiry never authorises automatic credit
--  * law 41    - independent verification AND authorised admin confirmation
--  * law 44    - no client action can self-credit or self-confirm
-- =============================================================================

-- Planning tier. Intention only; never presented to users as support.
create table app.deposit_token_candidates (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  network text not null default 'celo',
  chain_id integer not null default 42220,
  status text not null default 'CANDIDATE',
  notes text,
  created_at timestamptz not null default now(),
  constraint deposit_token_candidates_status_check check (status in ('CANDIDATE','VERIFIED','REJECTED','RETIRED')),
  constraint deposit_token_candidates_symbol_network_key unique (symbol, network)
);

-- Production tier. Only a row with is_active AND a verified contract address may be
-- returned to the client or accepted by the verifier.
create table app.deposit_token_configs (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 42220,
  symbol text not null,
  contract_address text,
  decimals smallint,
  is_active boolean not null default false,
  verified_at timestamptz,
  verification_source text,
  created_at timestamptz not null default now(),
  constraint deposit_token_configs_chain_symbol_key unique (chain_id, symbol),
  constraint deposit_token_configs_address_shape check (
    contract_address is null or contract_address ~ '^0x[0-9a-fA-F]{40}$'
  ),
  -- Activation requires verified evidence. Cannot be turned on by accident.
  constraint deposit_token_configs_active_requires_verification check (
    not is_active or (contract_address is not null and decimals is not null and verified_at is not null)
  )
);

comment on table app.deposit_token_configs is 'Production token allowlist. is_active = true requires a verified address and decimals.';

-- Averra-controlled receiving destinations, returned to the client by the server.
create table app.platform_destinations (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 42220,
  method text not null default 'MANUAL_MINIPAY_CRYPTO',
  address text not null,
  is_active boolean not null default false,
  verified_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint platform_destinations_address_shape check (address ~ '^0x[0-9a-fA-F]{40}$'),
  constraint platform_destinations_unique unique (chain_id, method, address)
);

create table app.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  method text not null default 'MANUAL_MINIPAY_CRYPTO',
  status app.deposit_status not null default 'PENDING',
  request_reference text not null,
  chain_id integer not null default 42220,
  declared_asset text,
  declared_token_contract text,
  declared_amount_minor bigint,
  declared_unit text,
  destination_address text not null,
  sender_address text,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  tx_hash text,
  token_contract text,
  token_decimals smallint,
  transfer_log_index integer,
  verified_amount_minor bigint,
  verified_at timestamptz,
  verification_status text,
  valuation_rate numeric(24, 12),
  valuation_source text,
  valuation_captured_at timestamptz,
  required_approvals integer not null default 1,
  admin_confirmed_at timestamptz,
  admin_confirmed_by uuid references auth.users(id),
  review_reason text,
  rejection_reason text,
  funding_ledger_entry_id bigint references app.ledger_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_requests_reference_unique unique (request_reference),
  constraint deposit_requests_method_check check (method in ('MANUAL_MINIPAY_CRYPTO','DAIMO_CRYPTO_DEPOSIT','MINIPAY_CASH_LINK')),
  constraint deposit_requests_amount_positive check (declared_amount_minor is null or declared_amount_minor > 0)
);

create trigger trg_deposit_requests_updated_at
  before update on app.deposit_requests
  for each row execute function app_private.set_updated_at();

-- LAW 51: uniqueness at the transfer-EVENT level, not the transaction level.
-- A single transaction can carry several token Transfer events, so tx_hash alone
-- would let two distinct transfers be treated as one -- or one as two.
create unique index uq_deposit_transfer_event
  on app.deposit_requests (chain_id, token_contract, tx_hash, transfer_log_index)
  where tx_hash is not null and token_contract is not null and transfer_log_index is not null;

create index idx_deposit_requests_user on app.deposit_requests(user_id, created_at desc);
create index idx_deposit_requests_queue on app.deposit_requests(status, created_at)
  where status in ('SUBMITTED','VERIFIED','NEEDS_REVIEW');

create table app.deposit_events (
  id bigint generated always as identity primary key,
  deposit_id uuid not null references app.deposit_requests(id) on delete cascade,
  event_type app.deposit_event_type not null,
  actor_type text not null default 'SYSTEM',
  actor_id uuid references auth.users(id),
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  created_at timestamptz not null default now(),
  constraint deposit_events_actor_check check (actor_type in ('SYSTEM','USER','ADMIN','CHAIN'))
);

create index idx_deposit_events_deposit on app.deposit_events(deposit_id, id);

create table app.deposit_verifications (
  id bigint generated always as identity primary key,
  deposit_id uuid not null references app.deposit_requests(id) on delete cascade,
  checked_at timestamptz not null default now(),
  result text not null,
  reason_code text,
  chain_id integer,
  token_contract text,
  destination_address text,
  observed_amount_minor bigint,
  confirmations integer,
  evidence jsonb not null default '{}'::jsonb,
  constraint deposit_verifications_result_check check (result in ('PASS','FAIL','REVIEW'))
);

create index idx_deposit_verifications_deposit on app.deposit_verifications(deposit_id, id desc);

alter table app.deposit_token_candidates enable row level security;
alter table app.deposit_token_configs enable row level security;
alter table app.platform_destinations enable row level security;
alter table app.deposit_requests enable row level security;
alter table app.deposit_events enable row level security;
alter table app.deposit_verifications enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;

-- Seed the CANDIDACY tier only. Four candidates, all inactive, no addresses.
-- Activation is an operational act requiring a verified contract address (ADR-0004).
insert into app.deposit_token_candidates (symbol, network, chain_id, status, notes) values
  ('USDT','celo',42220,'CANDIDATE','Planning-tier candidate. Awaiting verified Celo contract address.'),
  ('USDC','celo',42220,'CANDIDATE','Planning-tier candidate. Awaiting verified Celo contract address.'),
  ('USDm','celo',42220,'CANDIDATE','Remains inactive until verified. Do not infer support from symbol name.'),
  ('USAT','celo',42220,'CANDIDATE','Remains inactive until verified. Do not infer support from symbol name.')
on conflict (symbol, network) do nothing;

insert into app.deposit_token_configs (chain_id, symbol, contract_address, decimals, is_active, verified_at, verification_source) values
  (42220,'USDT',null,null,false,null,null),
  (42220,'USDC',null,null,false,null,null),
  (42220,'USDm',null,null,false,null,null),
  (42220,'USAT',null,null,false,null,null)
on conflict (chain_id, symbol) do nothing;

-- Native CELO is deliberately absent from both tables. It is never a deposit asset.
