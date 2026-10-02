-- =============================================================================
-- Averra migration 012: Notification and support commands
--
-- Source of truth: 45_NOTIFICATION_SYSTEM.txt, 44_SUPPORT_SYSTEM.txt,
--                  85_SUPPORT_AND_CONTACT_POLICY.md, 71_ARCHITECTURAL_LAWS.md
--                  laws 57-61, docs/adr/0001-financial-authority.md
-- =============================================================================

-- Creates a factual notification. Idempotent on p_idempotency_key, so a retried
-- job produces one notification rather than a stream of them (doc 45 RELIABILITY).
create or replace function app_private.create_notification(
  p_user_id uuid,
  p_category app.notification_category,
  p_title text,
  p_body text,
  p_idempotency_key text,
  p_action_path text default null,
  p_action_label text default null,
  p_source_event_type text default null,
  p_source_id text default null
) returns app.notifications
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_row app.notifications;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'create_notification: an idempotency key is required'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_title is null or length(trim(p_title)) = 0
     or p_body is null or length(trim(p_body)) = 0 then
    raise exception 'create_notification: title and body are required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Replay path. Returns the existing notification untouched.
  select * into v_row from app.notifications where idempotency_key = p_idempotency_key;
  if found then
    return v_row;
  end if;

  insert into app.notifications (
    user_id, category, title, body, action_path, action_label,
    source_event_type, source_id, idempotency_key
  ) values (
    p_user_id, p_category, p_title, p_body, p_action_path, p_action_label,
    p_source_event_type, p_source_id, p_idempotency_key
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Marks a notification read. Scoped to the owner: a user may only mark their own
-- notification, enforced by matching user_id in the UPDATE predicate.
create or replace function app_private.mark_notification_read(
  p_notification_id uuid,
  p_user_id uuid
) returns app.notifications
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_row app.notifications;
begin
  update app.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'mark_notification_read: notification not found'
      using errcode = 'foreign_key_violation';
  end if;

  return v_row;
end;
$$;

-- Opens a support ticket. Creates a record only. It moves no money and it grants
-- no exception (law 59: a Telegram conversation cannot authorize a financial
-- mutation, and neither can a ticket).
create or replace function app_private.create_support_ticket(
  p_user_id uuid,
  p_subject text,
  p_body text,
  p_category text default 'Other',
  p_linked_deposit_id uuid default null,
  p_linked_withdrawal_id uuid default null,
  p_linked_ledger_entry_id bigint default null,
  p_correlation_id uuid default null
) returns app.support_tickets
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_ticket app.support_tickets;
  v_reference text;
begin
  if p_subject is null or length(trim(p_subject)) < 3 then
    raise exception 'create_support_ticket: a subject is required'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'create_support_ticket: a description is required'
      using errcode = 'null_value_not_allowed';
  end if;

  v_reference := 'TKT-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));

  insert into app.support_tickets (
    reference, user_id, category, subject, status, priority,
    linked_deposit_id, linked_withdrawal_id, linked_ledger_entry_id
  ) values (
    v_reference, p_user_id, coalesce(p_category, 'Other'), p_subject, 'OPEN', 'NORMAL',
    p_linked_deposit_id, p_linked_withdrawal_id, p_linked_ledger_entry_id
  )
  returning * into v_ticket;

  -- The opening message is authored by the user, and is marked USER so it can
  -- never be mistaken for an agent reply.
  insert into app.support_messages (ticket_id, author_kind, author_user_id, body)
  values (v_ticket.id, 'USER', p_user_id, trim(p_body));

  insert into app.support_ticket_events (ticket_id, event_type, to_status, actor_user_id)
  values (v_ticket.id, 'TICKET_CREATED', 'OPEN', p_user_id);

  -- A factual system notification, not a support reply (law 60). The in-app
  -- ticket thread remains the authoritative conversation (law 58).
  perform app_private.create_notification(
    p_user_id, 'SUPPORT',
    'Support ticket received',
    'Your ticket ' || v_reference || ' has been received. A human agent will respond here.',
    'support.ticket.created:' || v_ticket.id::text,
    '/support/' || v_ticket.id::text,
    'View ticket',
    'support.ticket.created',
    v_ticket.id::text
  );

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    p_user_id, 'support.ticket_created', 'support_ticket', v_ticket.id::text,
    'SUCCESS', p_correlation_id,
    jsonb_build_object('reference', v_reference, 'category', v_ticket.category)
  );

  return v_ticket;
end;
$$;

-- Adds a HUMAN agent reply to a ticket.
--
-- This is the only function that may write an AGENT message. The support.reply
-- capability is verified by the caller BEFORE invocation, in the server route
-- (src/lib/auth/capabilities.ts), because a capability cannot be evaluated from
-- inside a service-role session the way auth.uid() would be.
--
-- There is deliberately NO parameter for "who generated this text". An AI
-- service cannot call this to impersonate an agent, because the only identity
-- available is the human operator id the server guard resolved from a verified
-- session (law 57, law 66, doc 79 CUSTOMER SUPPORT BOUNDARY).
create or replace function app_private.post_agent_reply(
  p_ticket_id uuid,
  p_agent_id uuid,
  p_body text,
  p_set_status text default null,
  p_attachment_refs jsonb default '[]'::jsonb,
  p_correlation_id uuid default null
) returns app.support_tickets
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_ticket app.support_tickets;
  v_message_id bigint;
  v_from app.ticket_status;
  v_to_status app.ticket_status;
begin
  if p_agent_id is null then
    raise exception 'post_agent_reply: an identified human agent is required'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'post_agent_reply: a reply body is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_ticket from app.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'post_agent_reply: unknown ticket %', p_ticket_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_ticket.status = 'CLOSED' then
    raise exception 'post_agent_reply: ticket is closed and must be reopened first'
      using errcode = 'check_violation';
  end if;

  v_from := v_ticket.status;

  insert into app.support_messages (
    ticket_id, author_kind, author_user_id, body, attachment_refs
  ) values (
    p_ticket_id, 'AGENT', p_agent_id, trim(p_body), coalesce(p_attachment_refs, '[]'::jsonb)
  )
  returning id into v_message_id;

  v_to_status := coalesce(
    nullif(p_set_status, '')::app.ticket_status,
    case when v_from in ('OPEN','ASSIGNED','WAITING_FOR_USER')
      then 'IN_PROGRESS'::app.ticket_status
      else v_from end
  );

  update app.support_tickets
  set status = v_to_status,
      assigned_to = coalesce(assigned_to, p_agent_id),
      assigned_at = coalesce(assigned_at, now()),
      first_response_at = coalesce(first_response_at, now()),
      resolved_at = case when v_to_status = 'RESOLVED' then now() else resolved_at end
  where id = p_ticket_id
  returning * into v_ticket;

  insert into app.support_ticket_events (
    ticket_id, event_type, from_status, to_status, actor_user_id
  ) values (
    p_ticket_id, 'AGENT_REPLIED', v_from, v_to_status, p_agent_id
  );

  -- Factual notification that an agent replied. It states the event and does not
  -- impersonate the conversation, which remains in the ticket thread (law 60).
  perform app_private.create_notification(
    v_ticket.user_id, 'SUPPORT',
    'Support replied to your ticket',
    'A support agent responded to ticket ' || v_ticket.reference || '.',
    'support.agent_replied:' || v_message_id::text,
    '/support/' || v_ticket.id::text,
    'Read the reply',
    'support.agent_replied',
    v_ticket.id::text
  );

  insert into app.audit_events (
    actor_user_id, capability, action, target_type, target_id, result, correlation_id, after_state
  ) values (
    p_agent_id, 'support.reply', 'support.agent_replied', 'support_ticket', p_ticket_id::text,
    'SUCCESS', p_correlation_id,
    jsonb_build_object('messageId', v_message_id, 'status', v_to_status::text)
  );

  return v_ticket;
end;
$$;

-- Adds a USER reply. A separate function from post_agent_reply so the author kind
-- can never be mislabelled by a caller.
create or replace function app_private.post_user_reply(
  p_ticket_id uuid,
  p_user_id uuid,
  p_body text
) returns app.support_tickets
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_ticket app.support_tickets;
  v_from app.ticket_status;
  v_to_status app.ticket_status;
begin
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'post_user_reply: a message body is required'
      using errcode = 'null_value_not_allowed';
  end if;

  select * into v_ticket from app.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'post_user_reply: unknown ticket %', p_ticket_id
      using errcode = 'foreign_key_violation';
  end if;

  -- A user may only post to their own ticket.
  if v_ticket.user_id <> p_user_id then
    raise exception 'post_user_reply: ticket does not belong to this user'
      using errcode = 'check_violation';
  end if;

  if v_ticket.status = 'CLOSED' then
    raise exception 'post_user_reply: ticket is closed and must be reopened first'
      using errcode = 'check_violation';
  end if;

  v_from := v_ticket.status;
  v_to_status := case when v_from = 'WAITING_FOR_USER'
    then 'IN_PROGRESS'::app.ticket_status else v_from end;

  insert into app.support_messages (ticket_id, author_kind, author_user_id, body)
  values (p_ticket_id, 'USER', p_user_id, trim(p_body));

  update app.support_tickets set status = v_to_status where id = p_ticket_id
  returning * into v_ticket;

  insert into app.support_ticket_events (ticket_id, event_type, from_status, to_status, actor_user_id)
  values (p_ticket_id, 'USER_REPLIED', v_from, v_to_status, p_user_id);

  return v_ticket;
end;
$$;

-- Closes or reopens a ticket. Reopening increments a counter rather than
-- resetting state, so repeated reopening is visible (doc 85 section 3).
create or replace function app_private.close_support_ticket(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_reopen boolean,
  p_reason text default null
) returns app.support_tickets
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_ticket app.support_tickets;
begin
  select * into v_ticket from app.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'close_support_ticket: unknown ticket %', p_ticket_id
      using errcode = 'foreign_key_violation';
  end if;

  if p_reopen then
    if v_ticket.status <> 'CLOSED' then
      raise exception 'close_support_ticket: only a closed ticket can be reopened'
        using errcode = 'check_violation';
    end if;

    update app.support_tickets
    set status = 'OPEN', closed_at = null, reopen_count = reopen_count + 1
    where id = p_ticket_id
    returning * into v_ticket;

    insert into app.support_ticket_events (ticket_id, event_type, from_status, to_status, actor_user_id, reason)
    values (p_ticket_id, 'TICKET_REOPENED', 'CLOSED', 'OPEN', p_actor_id, p_reason);
  else
    if v_ticket.status = 'CLOSED' then
      return v_ticket;
    end if;

    update app.support_tickets
    set status = 'CLOSED', closed_at = now()
    where id = p_ticket_id
    returning * into v_ticket;

    insert into app.support_ticket_events (ticket_id, event_type, from_status, to_status, actor_user_id, reason)
    values (p_ticket_id, 'TICKET_CLOSED', v_ticket.status, 'CLOSED', p_actor_id, p_reason);
  end if;

  return v_ticket;
end;
$$;

-- Lock down execution.
revoke all on function app_private.create_notification(uuid, app.notification_category, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function app_private.mark_notification_read(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.create_support_ticket(uuid, text, text, text, uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function app_private.post_agent_reply(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function app_private.post_user_reply(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.close_support_ticket(uuid, uuid, boolean, text) from public, anon, authenticated;

grant execute on function app_private.create_notification(uuid, app.notification_category, text, text, text, text, text, text, text) to service_role;
grant execute on function app_private.mark_notification_read(uuid, uuid) to service_role;
grant execute on function app_private.create_support_ticket(uuid, text, text, text, uuid, uuid, bigint, uuid) to service_role;
grant execute on function app_private.post_agent_reply(uuid, uuid, text, text, jsonb, uuid) to service_role;
grant execute on function app_private.post_user_reply(uuid, uuid, text) to service_role;
grant execute on function app_private.close_support_ticket(uuid, uuid, boolean, text) to service_role;
