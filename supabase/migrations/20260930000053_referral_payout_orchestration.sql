-- =============================================================================
-- Averra migration 053: Referral payout orchestration
--
-- Spec: 39_REFERRAL_SYSTEM.txt, the V1 programme, 71_ARCHITECTURAL_LAWS.md laws 8,
--       10 and 56, doc 45 RELIABILITY.
--
-- THE GAP THIS CLOSES
--
-- Migration 052 built `pay_referral_reward` and proved it works. Nothing CALLS it.
-- A referral becomes QUALIFIED by the CR-0025 engine and then sits there forever,
-- which is the same shape of defect as `paid_perk_orders` (Q-38): a working piece of
-- machinery with no driver.
--
-- WHY AN OUTBOX EVENT AND NOT A DIRECT CALL
--
-- The obvious implementation is a trigger that calls `pay_referral_reward`
-- directly. It is wrong, and wrong in a way that loses money:
--
--   * A payout is a MONEY MOVEMENT. If it fails inside the qualifying transaction -
--     budget exhausted, transient lock timeout - the whole qualification ROLLS BACK.
--     The user loses a legitimate qualification because of a payment problem.
--   * There is no retry, no visibility and no dead-letter. `outbox_events` has
--     attempts, leases and last_error precisely so a downstream failure is retried
--     and then recorded rather than silently discarded.
--
-- So the trigger only RECORDS that a payout is due, in the same transaction as the
-- qualification. The payment happens later, in the outbox worker, where a failure
-- retries and a permanent failure is observable. This is the transactional outbox
-- pattern already used for deposits, withdrawals and rewards.
--
-- RETRY SAFETY: three independent guards, so a retried event cannot double-pay.
--   1. `uq_outbox_dedup` on (event_type, aggregate_type, aggregate_id) while PENDING
--      or PROCESSING - one pending event per referral.
--   2. `pay_referral_reward` returns early when the referral is already REWARDED.
--   3. `grant_reward` is keyed on `referral-reward:<referral id>`.
--
-- NOT EXPOSED TO BROWSERS: there is no public RPC and no route. The worker calls it
-- server-side with the service role (law 56).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enqueue_referral_payout: fires when a referral becomes QUALIFIED
-- -----------------------------------------------------------------------------
create or replace function app_private.enqueue_referral_payout()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  -- Only the transition INTO QUALIFIED. A referral that is already QUALIFIED and has
  -- its `qualified_value_minor` updated must not enqueue a second payment.
  if new.status is distinct from 'QUALIFIED' then
    return new;
  end if;

  if old.status is not distinct from 'QUALIFIED' then
    return new;
  end if;

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'referral.payout_due', 'referral', new.id::text,
    jsonb_build_object(
      'referralId', new.id,
      -- The referrer, so the worker can notify them. Taken from the row, never a caller.
      'referrerUserId', new.referrer_user_id,
      'refereeUserId', new.referee_user_id,
      'qualifiedValueMinor', new.qualified_value_minor
    )
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function app_private.enqueue_referral_payout() from public, anon, authenticated;

drop trigger if exists trg_referral_payout_due on app.referrals;

create trigger trg_referral_payout_due
  after update on app.referrals
  for each row execute function app_private.enqueue_referral_payout();

-- -----------------------------------------------------------------------------
-- claim_due_referral_payouts: operator-triggered sweep for anything the trigger missed
-- -----------------------------------------------------------------------------
-- The trigger covers new qualifications. This covers the gaps it cannot: a referral
-- that qualified while the programme was unfunded, a delivery processed before this
-- migration existed, or a flag that was closed and reopened.
--
-- Deliberately an EXPLICIT call rather than a scheduled job, because there is no
-- scheduler in this project yet (docs 60/61/62 are unstarted). Safe to run at any
-- time: `uq_outbox_dedup` prevents a duplicate pending event, and already-paid
-- referrals are filtered out so the sweep never enqueues work the worker would reject.
create or replace function app_private.claim_due_referral_payouts()
returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_count integer;
begin
  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  select
    'referral.payout_due', 'referral', r.id::text,
    jsonb_build_object(
      'referralId', r.id,
      'referrerUserId', r.referrer_user_id,
      'refereeUserId', r.referee_user_id,
      'qualifiedValueMinor', r.qualified_value_minor
    )
  from app.referrals r
  where r.status = 'QUALIFIED'
    and not exists (select 1 from app.rewards rw where rw.id = r.reward_id)
  on conflict do nothing;

  get diagnostics v_count = row_count;

  raise notice 'REFERRALS: enqueued % due payout(s)', v_count;

  return v_count;
end;
$$;

revoke all on function app_private.claim_due_referral_payouts() from public, anon, authenticated;
grant execute on function app_private.claim_due_referral_payouts() to service_role;

-- Run once on apply so anything already QUALIFIED before this migration is picked up.
-- `on conflict do nothing` makes a second run a no-op, and already-paid referrals are
-- excluded above, so this is safe to repeat.
select app_private.claim_due_referral_payouts();