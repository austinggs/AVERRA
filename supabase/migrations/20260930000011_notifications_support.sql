-- =============================================================================
-- Averra migration 011: Notifications and Support
--
-- Source of truth: 45_NOTIFICATION_SYSTEM.txt, 44_SUPPORT_SYSTEM.txt,
--                  85_SUPPORT_AND_CONTACT_POLICY.md, 48_DATABASE_SCHEMA.txt,
--                  71_ARCHITECTURAL_LAWS.md laws 57-61
--
-- THE BOUNDARY THIS MIGRATION ENFORCES
--
-- A support message is human-authored. A notification is a factual system event.
-- They are different things and the database will not let them blur:
--
--   notifications is a separate table with no author column at all, so a
--     notification can never be a support reply (law 60).
--   app.author_kind has only 'USER' and 'AGENT'. There is no 'SYSTEM' value, so
--     no automated process can post into the conversational record (law 57).
--
-- That is why these are two tables rather than one with a flag. A flag can be
-- set wrongly; a missing enum value cannot.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Notifications (doc 45)
-- ---------------------------------------------------------------------------
-- First-party and database-backed. No paid notification provider is required or
-- referenced anywhere in this migration (law 61).

create type app.notification_category as enum (
  'REWARD','WITHDRAWAL','DEPOSIT','TASK','REFERRAL','SECURITY','SUPPORT','SYSTEM'
);

create type app.author_kind as enum ('USER','AGENT');

create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category app.notification_category not null default 'SYSTEM',

  -- Factual state text only. No conversational or AI-generated content.
  title text not null,
  body text not null,

  -- Where the user can go to act on this. Never a financial mutation endpoint.
  action_path text,
  action_label text,

  -- The domain event that produced this notification. Notification delivery is
  -- never the source of truth, so the authoritative record is referenced here.
  source_event_type text,
  source_id text,

  -- Idempotency. A retried job must not produce a duplicate notification
  -- (doc 45 RELIABILITY).
  idempotency_key text not null,

  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_idempotency_unique unique (idempotency_key),
  -- A notification must not smuggle an absolute URL off-site.
  constraint notifications_action_path_relative check (
    action_path is null or action_path ~ '^/[^/]'
  )
);

comment on table app.notifications is 'Factual system events for the in-app notification centre. Never a support reply (law 60).';

create index idx_notifications_user on app.notifications(user_id, created_at desc);
create index idx_notifications_unread on app.notifications(user_id, created_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Support (docs 44 and 85)
-- ---------------------------------------------------------------------------
-- Support is 100% human-operated. No AI writes a support reply, ever.

create type app.ticket_status as enum (
  'OPEN','ASSIGNED','IN_PROGRESS','WAITING_FOR_USER',
  'WAITING_FOR_INTERNAL_TEAM','RESOLVED','CLOSED'
);

create type app.ticket_priority as enum ('LOW','NORMAL','HIGH','URGENT');

create table app.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  user_id uuid not null references auth.users(id) on delete restrict,

  category text not null default 'Other',
  subject text not null,
  status app.ticket_status not null default 'OPEN',
  priority app.ticket_priority not null default 'NORMAL',

  -- Linked financial or operational entities, referenced NOT copied. A ticket
  -- links to a ledger entry or a deposit request; it never duplicates the
  -- evidence, so the two cannot disagree (doc 85 DATA MINIMIZATION).
  linked_deposit_id uuid references app.deposit_requests(id) on delete set null,
  linked_withdrawal_id uuid references app.withdrawal_requests(id) on delete set null,
  linked_ledger_entry_id bigint references app.ledger_entries(id) on delete set null,

  assigned_to uuid references auth.users(id),
  assigned_at timestamptz,

  -- Escalated to the team that owns the required control, e.g. payment ops.
  escalated_to_capability text,

  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopen_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint support_tickets_reference_unique unique (reference),
  constraint support_tickets_reopen_non_negative check (reopen_count >= 0)
);

create trigger trg_support_tickets_updated_at
  before update on app.support_tickets
  for each row execute function app_private.set_updated_at();

create index idx_support_tickets_user on app.support_tickets(user_id, created_at desc);
create index idx_support_tickets_queue on app.support_tickets(status, priority, created_at)
  where status not in ('CLOSED','RESOLVED');
create index idx_support_tickets_assignee on app.support_tickets(assigned_to, status)
  where assigned_to is not null;

comment on table app.support_tickets is 'The authoritative customer-support record (law 58). A Telegram conversation never replaces it (law 59).';

-- The conversational record. app.author_kind deliberately has NO 'SYSTEM' value.
create table app.support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references app.support_tickets(id) on delete cascade,
  author_kind app.author_kind not null,
  author_user_id uuid not null references auth.users(id),

  body text not null,
  -- Permitted evidence references. Never secrets (doc 85 section 6).
  attachment_refs jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  constraint support_messages_body_not_blank check (length(trim(body)) > 0),
  -- A message must identify its author. An unattributed message is unauditable.
  constraint support_messages_author_present check (author_user_id is not null)
);

create index idx_support_messages_ticket on app.support_messages(ticket_id, id);

-- Ticket status history, append-only.
create table app.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references app.support_tickets(id) on delete cascade,
  event_type text not null,
  from_status app.ticket_status,
  to_status app.ticket_status,
  actor_user_id uuid references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

create index idx_support_ticket_events_ticket on app.support_ticket_events(ticket_id, id);

create trigger trg_support_ticket_events_immutable
  before update or delete on app.support_ticket_events
  for each row execute function app_private.reject_mutation();

-- Audit hook for messages. An agent reply is a material support action and is
-- audit logged (law 57, doc 85 section 13).
create or replace function app_private.audit_support_message()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, after_state
  ) values (
    new.author_user_id,
    case when new.author_kind = 'AGENT'
      then 'support.agent_reply' else 'support.user_message' end,
    'support_ticket',
    new.ticket_id::text,
    'SUCCESS',
    jsonb_build_object('messageId', new.id, 'authorKind', new.author_kind)
  );
  return new;
end;
$$;

create trigger trg_support_messages_audit
  after insert on app.support_messages
  for each row execute function app_private.audit_support_message();

revoke all on function app_private.audit_support_message() from public, anon, authenticated;

alter table app.notifications enable row level security;
alter table app.support_tickets enable row level security;
alter table app.support_messages enable row level security;
alter table app.support_ticket_events enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;