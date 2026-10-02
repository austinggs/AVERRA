-- =============================================================================
-- Averra migration 001: Foundation
-- Schemas, domain state enums, identity, capability-based authorization,
-- audit trail, and a transactional outbox.
--
-- Source of truth:
--   43_ADMIN_PLATFORM.txt   (capability-based RBAC)
--   48_DATABASE_SCHEMA.txt  (domains, integrity, deliberate exposure)
--   53_SECURITY_ARCHITECTURE.txt (least privilege, secret boundary)
--   57_AUDIT_LOGGING.txt    (audit record shape)
--   71_ARCHITECTURAL_LAWS.md (laws 2, 10, 11, 16, 70, 71)
--   87_ADMIN_PORTAL_EXPANDED.md (dedicated internal schemas)
--
-- Design decisions (see docs/adr):
--   * Domain state enums are namespaced per domain. The token
--     ELIGIBILITY_CHECKED exists in BOTH the reward lifecycle (doc 05) and the
--     withdrawal lifecycle (doc 37). One shared enum would conflate two
--     different state machines, so reward_state and withdrawal_status are
--     separate types.
--   * app is deliberately NOT exposed through the Data API. Privileged work
--     runs through server-side code and SECURITY DEFINER functions.
--   * RLS is enabled on every table as defence in depth even though the schema
--     is unreachable by anon/authenticated.
-- =============================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

create schema if not exists app;
create schema if not exists app_private;

comment on schema app is 'Averra application and financial tables. Not exposed via the Data API.';
comment on schema app_private is 'Internal helper functions and privileged RPC entry points.';

-- Nothing in these schemas is reachable by browser-facing roles.
revoke all on schema app from public;
revoke all on schema app from anon;
revoke all on schema app from authenticated;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

grant usage on schema app to postgres, service_role;
grant usage on schema app_private to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Domain state machines (one enum per domain, names never shared across domains)
-- ---------------------------------------------------------------------------

create type app.reward_state as enum (
  'ELIGIBLE','PENDING','AVAILABLE','ON_HOLD','REVERSED','CHARGEBACK','CANCELLED','EXPIRED'
);

create type app.withdrawal_status as enum (
  'REQUESTED','ELIGIBILITY_CHECKED','RISK_REVIEW','APPROVED','PROCESSING',
  'PAYMENT_INITIATED','CONFIRMED','COMPLETED','FAILED','REJECTED','CANCELLED','EXPIRED'
);

-- Absorbs the SETTLEMENT step from doc 87 as its own lifecycle.
create type app.payment_settlement_status as enum (
  'NOT_STARTED','INITIATED','SETTLEMENT_PENDING','SETTLED','SETTLEMENT_FAILED','REVERSED'
);

-- Absorbs the RECONCILED step from doc 87 as its own lifecycle.
create type app.reconciliation_status as enum (
  'PENDING','MATCHED','VARIANCE','RESOLVED'
);

create type app.deposit_status as enum (
  'PENDING','SUBMITTED','VERIFIED','CONFIRMED','REJECTED','EXPIRED','NEEDS_REVIEW','CANCELLED'
);

create type app.deposit_event_type as enum (
  'CREATED','SUBMITTED','DETECTED','VERIFIED','NEEDS_REVIEW','CONFIRMED','REJECTED','EXPIRED','CANCELLED'
);

-- Earned Reward Balance and User Funding Balance are separate financial domains
-- and must never be derived from one another (laws 42, 56).
create type app.financial_domain as enum (
  'EARNED_REWARD','USER_FUNDING','PROVIDER_RECEIVABLE','SETTLED_REVENUE',
  'PAYOUT_CLEARING','DEPOSIT_CLEARING','FEE_REVENUE','RESERVE'
);

create type app.ledger_direction as enum ('DEBIT','CREDIT');

create type app.ledger_source_type as enum (
  'REWARD_EARNED','REWARD_REVERSED','REWARD_CHARGEBACK',
  'USER_FUNDING_DEPOSIT','USER_FUNDING_SPEND',
  'PLATFORM_SERVICE_MAINTENANCE_FEE',
  'WITHDRAWAL_RESERVATION','WITHDRAWAL_SETTLEMENT','WITHDRAWAL_RELEASE',
  'ADMIN_ADJUSTMENT'
);

create type app.account_status as enum ('ACTIVE','SUSPENDED','CLOSED');

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- `app.has_capability` is defined BELOW, after app.admin_users and
-- app.admin_role_capabilities exist.
--
-- It is declared `language sql`, which means PostgreSQL parses and validates the
-- body at CREATE time. Referencing a table that does not exist yet fails
-- immediately with SQLSTATE 42P01, which is what blocked the whole migration
-- run. (A `language plpgsql` body is not validated until it is first executed,
-- which is why only the SQL-language functions are affected by this ordering
-- rule.)

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  account_status app.account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app.profiles is 'Application profile, separate from the authentication identity in auth.users.';

create trigger trg_profiles_set_updated_at
  before update on app.profiles
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Capability-based authorization. Roles are bundles of capabilities; the
-- capability codes are the authorization primitive used by server guards.
-- ---------------------------------------------------------------------------

create table app.admin_capabilities (
  code text primary key,
  description text not null
);

comment on table app.admin_capabilities is 'Canonical capability identifiers. Server-side guards and RLS must use these exact codes.';

create table app.admin_roles (
  code text primary key,
  name text not null,
  description text,
  is_legacy_alias boolean not null default false,
  superseded_by text references app.admin_roles(code)
);

create table app.admin_role_capabilities (
  role_code text not null references app.admin_roles(code) on delete cascade,
  capability_code text not null references app.admin_capabilities(code) on delete cascade,
  primary key (role_code, capability_code)
);

create table app.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null references app.admin_roles(code),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id)
);

comment on table app.admin_users is 'Privileged operator assignment. Never authorise from client-supplied role fields.';

create index idx_admin_users_role on app.admin_users(role_code) where revoked_at is null;

-- Capability check, defined HERE because it depends on the two tables above.
--
-- Ordering matters: this is `language sql`, so PostgreSQL validates the body at
-- CREATE time. Defining it before app.admin_users existed failed the whole
-- migration with SQLSTATE 42P01.
create or replace function app.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select exists (
    select 1
    from app.admin_users au
    join app.admin_role_capabilities rc on rc.role_code = au.role_code
    where au.user_id = auth.uid()
      and rc.capability_code = p_capability
  );
$$;

revoke all on function app.has_capability(text) from public;
revoke all on function app.has_capability(text) from anon;
revoke all on function app.has_capability(text) from authenticated;
grant execute on function app.has_capability(text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Audit trail. Append-only from the application perspective.
-- ---------------------------------------------------------------------------

create table app.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  actor_role text,
  capability text,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  result text,
  correlation_id uuid,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_events_actor on app.audit_events(actor_user_id, created_at desc);
create index idx_audit_events_target on app.audit_events(target_type, target_id);
create index idx_audit_events_correlation on app.audit_events(correlation_id);

create or replace function app_private.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table: % cannot be %', tg_table_name, lower(tg_op)
    using errcode = 'restrict_violation';
end;
$$;

create trigger trg_audit_events_immutable
  before update or delete on app.audit_events
  for each row execute function app_private.reject_mutation();

-- ---------------------------------------------------------------------------
-- Transactional outbox: durable events written in the SAME transaction as the
-- state change, so an external side effect can never be silently lost.
-- ---------------------------------------------------------------------------

create type app.outbox_status as enum ('PENDING','PROCESSING','PROCESSED','FAILED','DEAD');

create table app.outbox_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  aggregate_type text,
  aggregate_id text,
  payload jsonb not null default '{}'::jsonb,
  status app.outbox_status not null default 'PENDING',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index idx_outbox_pending on app.outbox_events(available_at) where status = 'PENDING';
create unique index uq_outbox_dedup on app.outbox_events(event_type, aggregate_type, aggregate_id)
  where status in ('PENDING','PROCESSING');

-- ---------------------------------------------------------------------------
-- Defence in depth: RLS enabled everywhere and no table privileges for the
-- browser-facing roles.
-- ---------------------------------------------------------------------------

alter table app.profiles enable row level security;
alter table app.admin_capabilities enable row level security;
alter table app.admin_roles enable row level security;
alter table app.admin_role_capabilities enable row level security;
alter table app.admin_users enable row level security;
alter table app.audit_events enable row level security;
alter table app.outbox_events enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;

alter default privileges in schema app revoke all on tables from anon, authenticated;
alter default privileges in schema app grant all on tables to service_role;
