-- =============================================================================
-- Averra migration 006: Withdrawal and payout subsystem
--
-- Source of truth: 37_WITHDRAWAL_SYSTEM.txt, 38_PAYMENT_OPERATIONS.txt,
--                  36_WALLET_LEDGER.txt, 48_DATABASE_SCHEMA.txt,
--                  56_FINANCIAL_CONTROLS.txt, 11_AUTH_IDENTITY_KYC.txt,
--                  71_ARCHITECTURAL_LAWS.md, docs/adr/0003-withdrawal-lifecycle.md
--
-- Enforced here, not by convention:
--  * law 14 - withdrawal state is separate from wallet balance
--  * law 28 - payment completion and wallet accounting are separate
--  * law 45 - the 15% fee is disclosed before confirmation and recorded separately
--  * law 46 - the fee never alters reward rates or eligibility
--  * law 27 - manual payment actions are operator-attributed
--  * law 22 - manual withdrawals are actually manual
--  * law 23 - a MiniPay payout destination must be manually verified first
--  * law 40 - automatic Daimo never silently falls back to a manual method
--  * ADR-0003 - three orthogonal lifecycles, not one merged state machine
--  * doc 37 - ONLY earned reward balance is withdrawable. User Funding Balance is
--              NOT a withdrawal source, even though it is a real balance.
-- =============================================================================

-- Manual payout destinations. A destination is not usable until verified.
create table app.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  method text not null,
  account_identifier text not null,
  account_holder text,
  bank_name text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING_VERIFICATION',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_destinations_method_check check (
    method in ('MINIPAY_MANUAL','BANK_MANUAL','CRYPTO_AUTOMATIC_DAIMO')
  ),
  constraint payout_destinations_status_check check (
    status in ('PENDING_VERIFICATION','VERIFIED','REJECTED','REVOKED')
  )
);

create trigger trg_payout_destinations_updated_at
  before update on app.payout_destinations
  for each row execute function app_private.set_updated_at();

create index idx_payout_destinations_user on app.payout_destinations(user_id, created_at desc);

comment on table app.payout_destinations is 'Where a user is paid. Not usable for a manual payout until a human has verified it.';

-- Manual MiniPay destination verification. This is an operational payment
-- control, NOT KYC and NOT identity verification (doc 11).
create table app.minipay_destination_verifications (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references app.payout_destinations(id) on delete cascade,
  created_at timestamptz not null default now(),
  reviewer_id uuid not null references auth.users(id),
  decision text not null,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  constraint minipay_destination_verifications_decision_check check (decision in ('VERIFIED','REJECTED')),
  constraint minipay_destination_verifications_unique unique (destination_id)
);

comment on table app.minipay_destination_verifications is 'Human verification that a MiniPay destination is usable for this account. Not KYC.';

-- The withdrawal request. The user-visible workflow, doc 37 vocabulary.
create table app.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  method text not null,
  status app.withdrawal_status not null default 'REQUESTED',
  destination_id uuid not null references app.payout_destinations(id) on delete restrict,
  unit text not null,

  -- Gross / fee / net are STORED, not recomputed at display time, so the amount
  -- the user was shown before confirmation is the amount that is honoured
  -- (doc 37 FLOW, law 45).
  gross_amount_minor bigint not null,
  fee_amount_minor bigint not null,
  net_amount_minor bigint not null,
  fee_basis_points integer not null default 1500,
  fee_disclosure text,

  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,

  reservation_entry_id bigint references app.ledger_entries(id),
  fee_entry_id bigint references app.ledger_entries(id),
  settlement_entry_id bigint references app.ledger_entries(id),
  release_entry_id bigint references app.ledger_entries(id),

  risk_hold boolean not null default false,
  risk_reason text,
  required_approvals integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint withdrawal_requests_method_check check (
    method in ('MINIPAY_MANUAL','BANK_MANUAL','CRYPTO_AUTOMATIC_DAIMO')
  ),
  constraint withdrawal_requests_gross_positive check (gross_amount_minor > 0),
  -- gross = fee + net exactly. No rounding drift, no free money, no shortfall.
  constraint withdrawal_requests_split_exact check (fee_amount_minor + net_amount_minor = gross_amount_minor),
  constraint withdrawal_requests_net_non_negative check (net_amount_minor >= 0),
  constraint withdrawal_requests_basis_points_check check (fee_basis_points between 0 and 10000)
);

create trigger trg_withdrawal_requests_updated_at
  before update on app.withdrawal_requests
  for each row execute function app_private.set_updated_at();

create index idx_withdrawal_requests_user on app.withdrawal_requests(user_id, requested_at desc);
create index idx_withdrawal_requests_queue on app.withdrawal_requests(status, requested_at)
  where status in ('REQUESTED','ELIGIBILITY_CHECKED','RISK_REVIEW','APPROVED','PROCESSING');

comment on column app.withdrawal_requests.gross_amount_minor is 'Amount reserved from EARNED_REWARD. The fee is taken from this, never added to it.';

-- The payment operation. Settlement is its own lifecycle (ADR-0003).
create table app.payment_operations (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references app.withdrawal_requests(id) on delete restrict,
  method text not null,
  -- Manual methods are performed by a human. Automatic methods are performed by
  -- a provider adapter. Both are recorded identically so accounting is uniform.
  execution_mode text not null default 'MANUAL_OPERATOR',
  settlement_status app.payment_settlement_status not null default 'NOT_STARTED',
  reconciliation_status app.reconciliation_status not null default 'PENDING',

  -- Manual: who did it, and the external reference they observed.
  operator_id uuid references auth.users(id),
  operator_completed_at timestamptz,
  external_reference text,
  evidence jsonb not null default '{}'::jsonb,

  -- Automatic: the provider adapter's own idempotency and callback state.
  provider text,
  provider_reference text,
  provider_callback_at timestamptz,

  failure_reason text,
  variance_minor bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_operations_execution_mode_check check (
    execution_mode in ('MANUAL_OPERATOR','AUTOMATIC_ADAPTER')
  ),
  -- An automatic operation MUST name its adapter. A manual one MUST name the human.
  constraint payment_operations_attribution_check check (
    (execution_mode = 'MANUAL_OPERATOR' and operator_id is not null)
    or (execution_mode = 'AUTOMATIC_ADAPTER' and provider is not null)
  ),
  -- An automatic operation is never a manual method, and vice versa. This is the
  -- database half of law 40: no silent fallback.
  constraint payment_operations_mode_matches_method check (
    (execution_mode = 'AUTOMATIC_ADAPTER' and method = 'CRYPTO_AUTOMATIC_DAIMO')
    or (execution_mode = 'MANUAL_OPERATOR' and method in ('MINIPAY_MANUAL','BANK_MANUAL'))
  )
);

create trigger trg_payment_operations_updated_at
  before update on app.payment_operations
  for each row execute function app_private.set_updated_at();

create index idx_payment_operations_withdrawal on app.payment_operations(withdrawal_id);
-- Provider dedup: a replayed provider callback cannot create a second operation.
create unique index uq_payment_operations_provider_ref
  on app.payment_operations(provider, provider_reference)
  where provider is not null and provider_reference is not null;

-- A Cash Link is a payment instrument reference, never a settlement command.
create table app.cash_link_operations (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  withdrawal_id uuid references app.withdrawal_requests(id) on delete restrict,
  payer_reference text,
  receiver_reference text,
  amount_minor bigint not null,
  unit text not null,
  asset_symbol text,
  network text,
  link_reference text not null,
  provider text not null default 'MINIPAY',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Settlement is verified independently. created/opened/claimed is NOT settled.
  settlement_status app.payment_settlement_status not null default 'NOT_STARTED',
  settlement_reference text,
  settled_at timestamptz,
  reconciliation_status app.reconciliation_status not null default 'PENDING',
  constraint cash_link_operations_direction_check check (direction in ('INBOUND_FUNDING','OUTBOUND_PAYOUT')),
  constraint cash_link_operations_amount_positive check (amount_minor > 0)
);

create unique index uq_cash_link_reference on app.cash_link_operations(link_reference);
create index idx_cash_link_withdrawal on app.cash_link_operations(withdrawal_id);

comment on table app.cash_link_operations is 'A created, opened, copied or claimed Cash Link is NOT settlement. Only verified settlement completes a financial operation.';
-- Fee record. The fee is a distinct financial line item, never folded into the
-- reward history (law 45, doc 83).
create table app.fee_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  withdrawal_id uuid references app.withdrawal_requests(id) on delete restrict,
  fee_type text not null default 'PLATFORM_SERVICE_MAINTENANCE_FEE',
  basis_points integer not null,
  gross_amount_minor bigint not null,
  fee_amount_minor bigint not null,
  net_amount_minor bigint not null,
  unit text not null,
  ledger_entry_id bigint references app.ledger_entries(id),
  created_at timestamptz not null default now(),
  constraint fee_records_type_check check (fee_type in ('PLATFORM_SERVICE_MAINTENANCE_FEE')),
  constraint fee_records_split_exact check (fee_amount_minor + net_amount_minor = gross_amount_minor),
  constraint fee_records_basis_points_check check (basis_points between 0 and 10000)
);

-- One fee per withdrawal. A retried settlement cannot mint a second fee.
create unique index uq_fee_records_withdrawal on app.fee_records(withdrawal_id)
  where withdrawal_id is not null;

comment on table app.fee_records is 'The 15% Platform Service and Maintenance Fee. Applies to eligible withdrawals ONLY, never to deposits.';

-- Reconciliation of external settlement against internal records.
create table app.reconciliation_records (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  reference_type text not null,
  reference_id text not null,
  status app.reconciliation_status not null default 'PENDING',
  expected_minor bigint,
  observed_minor bigint,
  variance_minor bigint,
  reason text,
  reconciled_by uuid references auth.users(id),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reconciliation_records_scope_check check (scope in ('DEPOSIT','WITHDRAWAL','FEE','FUNDING_SPEND')),
  constraint reconciliation_records_reference_check check (
    reference_type in ('deposit_request','withdrawal_request','payment_operation','fee_record','ledger_entry')
  )
);

create index idx_reconciliation_records_open on app.reconciliation_records(scope, status)
  where status in ('PENDING','VARIANCE');
create index idx_reconciliation_records_reference on app.reconciliation_records(reference_type, reference_id);

-- RLS + privilege lockdown, identical posture to migrations 003 and 005.
alter table app.payout_destinations enable row level security;
alter table app.minipay_destination_verifications enable row level security;
alter table app.withdrawal_requests enable row level security;
alter table app.payment_operations enable row level security;
alter table app.cash_link_operations enable row level security;
alter table app.fee_records enable row level security;
alter table app.reconciliation_records enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
