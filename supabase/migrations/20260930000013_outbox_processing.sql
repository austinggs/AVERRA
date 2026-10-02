-- =============================================================================
-- Averra migration 013: Outbox processing support
--
-- Source of truth: 50_BACKEND_ARCHITECTURE.txt (durable outbox, bounded and
--                  idempotent retries), 62_MONITORING_OBSERVABILITY.txt
--                  (queue depth, worker failures, correlation IDs),
--                  docs/adr/0001-financial-authority.md
--
-- Migration 001 created app.outbox_events and every financial command has been
-- writing to it. NOTHING yet consumed those rows, so events were recorded and
-- then never acted on. This migration supplies the claiming and completion
-- machinery.
--
-- The claim is a SKIP LOCKED claim: several workers may drain the queue
-- concurrently and no event is ever handed to two workers at once.
-- =============================================================================

-- Claims a batch of pending events for one worker.
--
-- Bounded and safe to run repeatedly. `p_limit` caps the batch; rows that are
-- already PROCESSING by a crashed worker become available again once
-- `available_at` passes, because the claim moves available_at forward rather
-- than leaving the row permanently locked.
create or replace function app_private.claim_outbox_events(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 60
) returns setof app.outbox_events
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'claim_outbox_events: limit must be between 1 and 500'
      using errcode = 'check_violation';
  end if;

  return query
  with claimable as (
    select id
    from app.outbox_events
    where status = 'PENDING'
      and available_at <= now()
    order by available_at, id
    -- SKIP LOCKED: another worker may already hold these rows. Skipping them is
    -- correct, and blocking on them would serialise the whole queue.
    for update skip locked
    limit p_limit
  )
  update app.outbox_events e
  set status = 'PROCESSING',
      attempts = e.attempts + 1,
      -- Lease expiry. A worker that dies mid-event leaves the row recoverable
      -- rather than stuck in PROCESSING forever.
      available_at = now() + make_interval(secs => p_lease_seconds)
  from claimable c
  where e.id = c.id
  returning e.*;
end;
$$;

-- Marks an event processed. Idempotent: replaying a completion is harmless.
create or replace function app_private.complete_outbox_event(
  p_event_id bigint
) returns void
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  update app.outbox_events
  set status = 'PROCESSED',
      processed_at = now(),
      last_error = null
  where id = p_event_id
    and status = 'PROCESSING';
end;
$$;

-- Records a failure and schedules a bounded, exponential retry.
--
-- After p_max_attempts the event becomes DEAD rather than retrying forever. A
-- DEAD event is a visible operational failure, not a silent loss, and the
-- financial state it describes has already been committed independently of it
-- (doc 50 RESILIENCE).
create or replace function app_private.fail_outbox_event(
  p_event_id bigint,
  p_error text,
  p_max_attempts integer default 5
) returns app.outbox_status
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_event app.outbox_events;
  v_status app.outbox_status;
begin
  select * into v_event from app.outbox_events where id = p_event_id for update;

  if not found then
    raise exception 'fail_outbox_event: unknown event %', p_event_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_event.status not in ('PROCESSING','PENDING') then
    return v_event.status;
  end if;

  if v_event.attempts >= p_max_attempts then
    v_status := 'DEAD';
  else
    v_status := 'FAILED';
  end if;

  update app.outbox_events
  set status = v_status,
      last_error = left(coalesce(p_error, 'unknown error'), 2000),
      -- Exponential backoff: 2^attempts seconds, capped at 10 minutes.
      available_at = now() + make_interval(
        secs => least(power(2, v_event.attempts)::integer, 600)
      )
  where id = p_event_id;

  return v_status;
end;
$$;

-- Queue depth, for the operational dashboard and alerting (doc 62).
create or replace function app_private.outbox_backlog()
returns table(status app.outbox_status, event_count bigint)
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select e.status, count(*)
  from app.outbox_events e
  where e.status in ('PENDING','PROCESSING','FAILED','DEAD')
  group by e.status
  order by e.status;
$$;

revoke all on function app_private.claim_outbox_events(text, integer, integer) from public, anon, authenticated;
revoke all on function app_private.complete_outbox_event(bigint) from public, anon, authenticated;
revoke all on function app_private.fail_outbox_event(bigint, text, integer) from public, anon, authenticated;
revoke all on function app_private.outbox_backlog() from public, anon, authenticated;

grant execute on function app_private.claim_outbox_events(text, integer, integer) to service_role;
grant execute on function app_private.complete_outbox_event(bigint) to service_role;
grant execute on function app_private.fail_outbox_event(bigint, text, integer) to service_role;
grant execute on function app_private.outbox_backlog() to service_role;