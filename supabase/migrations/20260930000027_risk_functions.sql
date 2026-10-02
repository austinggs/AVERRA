-- =============================================================================
-- Averra migration 027: Risk decision function
--
-- Source of truth: 40_FRAUD_ANTI_ABUSE.txt, 71_ARCHITECTURAL_LAWS.md law 42
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
--
-- Doc 40 FINANCIAL INTEGRITY: "Risk decisions may hold or reject future events
-- but must not silently rewrite financial history."
--
-- So `record_risk_decision` inserts a row and NOTHING ELSE. It does not call
-- `post_ledger_entry`, `grant_reward`, `reverse_reward`, `transition_reward` or
-- any balance primitive. There is no parameter through which a caller could ask
-- it to move money. The only thing a HOLD does is mark a FUTURE event for
-- review at the point that event is evaluated.
--
-- This is verified by a pgTAP test that inspects pg_proc.prosrc, so the
-- guarantee is checked against the deployed function rather than this comment.
-- =============================================================================

create or replace function app_private.record_risk_decision(
  p_subject_type app.risk_subject,
  p_subject_user_id uuid,
  p_decision app.risk_decision,
  p_reason_code text,
  p_signal_ids bigint[] default '{}',
  p_evidence jsonb default '{}'::jsonb,
  p_notes text default null,
  p_decided_by uuid default null,
  p_expires_at timestamptz default null,
  p_correlation_id uuid default null
) returns app.risk_decisions
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_decision app.risk_decisions;
begin
  -- Doc 40: reason codes are mandatory. A decision without one is refused, so
  -- enforcement is never unexplained and support can always answer "why".
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'record_risk_decision: a reason code is required'
      using errcode = 'check_violation';
  end if;

  -- A TERMINATE is deliberate and must not be given an expiry, or it could
  -- lapse into an ALLOW without anyone deciding that it should.
  if p_decision = 'TERMINATE' and p_expires_at is not null then
    raise exception 'record_risk_decision: TERMINATE must not expire'
      using errcode = 'check_violation';
  end if;

  -- A decision about a USER must name the user. Otherwise it would apply to
  -- nobody while appearing to apply to someone.
  if p_subject_type = 'USER' and p_subject_user_id is null then
    raise exception 'record_risk_decision: a USER decision must name the user'
      using errcode = 'check_violation';
  end if;

  insert into app.risk_decisions (
    subject_type, subject_user_id, decision, reason_code, notes,
    evidence, signal_ids, decided_by, expires_at
  ) values (
    p_subject_type, p_subject_user_id, p_decision, trim(p_reason_code), p_notes,
    coalesce(p_evidence, '{}'::jsonb), coalesce(p_signal_ids, '{}'), p_decided_by, p_expires_at
  )
  returning * into v_decision;

  -- Audit trail. Doc 57: every privileged decision is recorded.
  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_decided_by, 'risk.decision', 'user', p_subject_user_id::text,
    p_reason_code, p_decision::text, p_correlation_id,
    jsonb_build_object(
      'decisionId', v_decision.id,
      'subjectType', p_subject_type,
      'signalCount', coalesce(array_length(p_signal_ids, 1), 0)
    )
  );

  return v_decision;
end;
$$;

-- Doc 40: reads the CURRENT effective decision for a user, so a caller can gate
-- a future event on it. Read-only by construction: it selects and returns, and
-- has no write path at all.
create or replace function app_private.current_risk_decision(
  p_user_id uuid
) returns app.risk_decisions
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_decision app.risk_decisions;
begin
  select * into v_decision
  from app.risk_decisions
  where subject_user_id = p_user_id
    and superseded_by_id is null
    and (expires_at is null or expires_at > now())
  order by created_at desc, id desc
  limit 1;

  -- No row is the correct answer for a user with no history, and it means
  -- "no decision", which is ALLOW. Returning null rather than a synthetic ALLOW
  -- row keeps the append-only log free of entries that record nothing.
  return v_decision;
end;
$$;

revoke all on function app_private.record_risk_decision(app.risk_subject, uuid, app.risk_decision, text, bigint[], jsonb, text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function app_private.current_risk_decision(uuid) from public, anon, authenticated;

grant execute on function app_private.record_risk_decision(app.risk_subject, uuid, app.risk_decision, text, bigint[], jsonb, text, uuid, timestamptz, uuid) to service_role;
grant execute on function app_private.current_risk_decision(uuid) to service_role;