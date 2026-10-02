-- =============================================================================
-- pgTAP: notification and support invariants
--
-- Spec: 45_NOTIFICATION_SYSTEM.txt, 44_SUPPORT_SYSTEM.txt,
--       85_SUPPORT_AND_CONTACT_POLICY.md, 71_ARCHITECTURAL_LAWS.md laws 57-61
--
-- The tests that matter most here prove a SYSTEM cannot post a support reply,
-- because that boundary is expressed structurally rather than by convention.
-- =============================================================================

begin;

select plan(17);

select has_table('app', 'notifications', 'notifications table exists');
select has_table('app', 'support_tickets', 'support tickets table exists');
select has_table('app', 'support_messages', 'support messages table exists');
select has_table('app', 'support_ticket_events', 'support ticket events exist');

-- ---------------------------------------------------------------------------
-- LAW 57 / 66: app.author_kind has NO 'SYSTEM' value.
--
-- This is the whole human-only guarantee expressed as a missing enum member. An
-- automated process has no value it could insert, so it cannot write a reply.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text
   from pg_enum e
   join pg_type t on t.oid = e.enumtypid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app' and t.typname = 'author_kind'),
  '{USER,AGENT}',
  'author_kind contains only USER and AGENT; there is no SYSTEM value'
);

-- A notification is a separate table with no author column at all, so it cannot
-- be mistaken for a support reply (law 60).
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'notifications'
      and column_name in ('author_kind','author_user_id','body_author')
  ),
  'notifications has no author column, so a notification cannot impersonate a reply'
);

select throws_ok(
  $$
    insert into app.support_messages (ticket_id, author_kind, author_user_id, body)
    values (gen_random_uuid(), 'USER', gen_random_uuid(), '   ')
  $$,
  '23514',
  'new row for relation "support_messages" violates check constraint "support_messages_body_not_blank"',
  'a blank support message body is rejected'
);

select results_eq(
  $$
    select count(*) from pg_policies
    where schemaname = 'app' and tablename = 'support_messages'
  $$,
  $$ values (0::bigint) $$,
  'no permissive RLS policy exposes support messages; access is server-side only'
);

select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in ('notifications','support_tickets','support_messages','support_ticket_events')
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every notification and support table'
);

-- Support ticket history is append-only, like the audit log.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'support_ticket_events'
      and t.tgname = 'trg_support_ticket_events_immutable'
  $$,
  $$ values (1::bigint) $$,
  'support ticket events are protected by an append-only trigger'
);

-- An agent reply is audit logged by trigger, so it cannot be written unrecorded.
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'support_messages'
      and t.tgname = 'trg_support_messages_audit'
  $$,
  $$ values (1::bigint) $$,
  'agent replies are automatically audit logged'
);

-- LAW 61: no paid notification provider, and no browser-facing execution.
select ok(
  not exists (
    select 1 from information_schema.routines
    where routine_schema = 'app' and lower(routine_name) like '%twilio%'
  ),
  'no third-party notification provider routine exists'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'create_notification','mark_notification_read','create_support_ticket',
        'post_agent_reply','post_user_reply','close_support_ticket'
      )
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can create notifications or post support messages'
);

-- A notification cannot smuggle an off-site link into the app.
select throws_ok(
  $$
    insert into app.notifications (
      user_id, category, title, body, action_path, idempotency_key
    )
    values (
      gen_random_uuid(), 'SYSTEM', 't', 'b', 'https://evil.example/steal', 'k1'
    )
  $$,
  '23514',
  'new row for relation "notifications" violates check constraint "notifications_action_path_relative"',
  'an absolute off-site notification action path is rejected'
);

-- Retried jobs must not produce duplicate notifications.
select has_index(
  'app', 'notifications', 'notifications_idempotency_unique',
  'notifications are idempotent so a retried job cannot duplicate them'
);

select results_eq(
  $$
    select count(*) from information_schema.columns
    where table_schema = 'app' and table_name = 'support_tickets'
      and column_name in ('linked_deposit_id','linked_withdrawal_id','linked_ledger_entry_id')
  $$,
  $$ values (3::bigint) $$,
  'support tickets reference financial records by link rather than copying them'
);

-- The vocabulary is asserted as `name[]`, not `text`. `pg_enum.enumlabel` is
-- type `name`, whose collation is C, and casting it to text CARRIES that
-- collation: comparing the result against a `text` literal under the database's
-- default collation fails outright with "could not determine which collation to
-- use for string comparison". The original test counted rows in pg_type, which
-- is 1 for a type that exists, rather than the labels that define it.
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)
   from pg_enum e
   join pg_type t on t.oid = e.enumtypid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app' and t.typname = 'notification_category'),
  '{REWARD,WITHDRAWAL,DEPOSIT,TASK,REFERRAL,SECURITY,SUPPORT,SYSTEM}'::name[],
  'notification categories match the doc 45 event list'
);

select * from finish();
rollback;
