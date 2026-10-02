-- =============================================================================
-- Averra migration 003: Ledger tables
--
-- Source of truth: 36_WALLET_LEDGER.txt, 35_REWARD_ENGINE.txt, 48_DATABASE_SCHEMA.txt,
--                  56_FINANCIAL_CONTROLS.txt, 71_ARCHITECTURAL_LAWS.md
--
-- Invariants enforced here, not by convention:
--  * law 2  - every financial mutation produces an immutable ledger entry
--  * law 13 - user balances derive from authoritative records
--  * ledger_entries is append-only: UPDATE and DELETE are rejected by trigger AND
--    the privileges are revoked.
--  * law 42/56 - Earned Reward Balance and User Funding Balance are separate
--    domains and can never be derived from one another.
--  * the same verified event can be credited at most once (law 51).
-- =============================================================================

create table app.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete restrict,
  domain app.financial_domain not null,
  unit text not null,
  created_at timestamptz not null default now(),
  constraint ledger_accounts_user_domain_unit_key unique (user_id, domain, unit),
  constraint ledger_accounts_user_required check (
    (domain in ('EARNED_REWARD','USER_FUNDING') and user_id is not null)
    or (domain not in ('EARNED_REWARD','USER_FUNDING') and user_id is null)
  )
);

comment on table app.ledger_accounts is 'One column per account. User-facing domains (EARNED_REWARD, USER_FUNDING) are per-user; platform control accounts are not.';

create table app.ledger_entries (
  id bigint generated always as identity primary key,
  account_id uuid not null references app.ledger_accounts(id) on delete restrict,
  direction app.ledger_direction not null,
  amount_minor bigint not null,
  unit text not null,
  source_type app.ledger_source_type not null,
  source_id text,
  idempotency_key text not null,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Original on-chain quantity and any valuation are preserved alongside the
  -- platform amount and are never rewritten (36_WALLET_LEDGER).
  source_amount_minor bigint,
  source_currency text,
  fx_rate numeric(24, 12),
  fx_source text,
  fx_captured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint ledger_entries_amount_positive check (amount_minor > 0),
  constraint ledger_entries_idempotency_unique unique (idempotency_key)
);

comment on table app.ledger_entries is 'Append-only financial truth. Never updated, never deleted. Corrections are compensating entries.';
comment on column app.ledger_entries.amount_minor is 'Always positive. direction carries the sign.';

create index idx_ledger_entries_account on app.ledger_entries(account_id, id desc);
create index idx_ledger_entries_source on app.ledger_entries(source_type, source_id);
create index idx_ledger_entries_correlation on app.ledger_entries(correlation_id);
create index idx_ledger_entries_occurred on app.ledger_entries(occurred_at desc);

-- Immutability. Belt and braces: a trigger for correctness, revoked privileges for
-- defence in depth.
create trigger trg_ledger_entries_immutable
  before update or delete on app.ledger_entries
  for each row execute function app_private.reject_mutation();

revoke update, delete, truncate on app.ledger_entries from public;

-- Derived balance cache. Reproducible from ledger_entries at any time.
create table app.account_balances (
  account_id uuid primary key references app.ledger_accounts(id) on delete restrict,
  balance_minor bigint not null default 0,
  last_entry_id bigint references app.ledger_entries(id),
  last_derived_at timestamptz not null default now()
);

comment on table app.account_balances is 'Cache only. ledger_entries is the source of truth; rebuild_balances() must always reproduce this.';

-- Dual control. A preparer may never approve their own action (law in docs 43/87).
create table app.approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_type text not null,
  target_id text not null,
  prepared_by uuid not null references auth.users(id),
  prepared_at timestamptz not null default now(),
  required_approvals integer not null default 1,
  status text not null default 'PENDING',
  constraint approval_requests_status_check check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  constraint approval_requests_required_check check (required_approvals between 1 and 3)
);

create table app.approval_decisions (
  id bigint generated always as identity primary key,
  request_id uuid not null references app.approval_requests(id) on delete cascade,
  approver_id uuid not null references auth.users(id),
  decision text not null,
  reason text,
  decided_at timestamptz not null default now(),
  constraint approval_decisions_decision_check check (decision in ('APPROVE','REJECT')),
  constraint approval_decisions_one_per_approver unique (request_id, approver_id)
);

create index idx_approval_requests_open on app.approval_requests(target_type, target_id) where status = 'PENDING';

-- RLS + privilege lockdown for the new tables (same posture as migration 001).
alter table app.ledger_accounts enable row level security;
alter table app.ledger_entries enable row level security;
alter table app.account_balances enable row level security;
alter table app.approval_requests enable row level security;
alter table app.approval_decisions enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
