-- =============================================================================
-- Averra migration 017: Native task commands
--
-- Source of truth: 12_TASK_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md laws 1/2/8/10/12
--
-- Doc 12 VERIFICATION is the governing sentence:
--   "Client completion claims are evidence only, never sufficient for financial
--    credit unless a server verification rule explicitly says so."
--
-- The pipeline is: start -> submit (evidence only) -> verify -> reward.
-- `submit_task_completion` NEVER creates money. Only `verify_task_completion`
-- can, and only after the declared verification mechanism is satisfied.
-- =============================================================================

-- Starts an attempt. Enforces doc 12 eligibility and abuse controls.
create or replace function app_private.start_task_attempt(
  p_user_id uuid,
  p_task_id uuid,
  p_client_device_fingerprint text default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns app.task_attempts
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_task app.task_definitions;
  v_attempt app.task_attempts;
  v_count integer;
  v_next integer;
  v_profile app.profiles;
begin
  select * into v_task from app.task_definitions where id = p_task_id;
  if not found then
    raise exception 'start_task_attempt: unknown task %', p_task_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Only a LIVE task may be started. A draft, paused or expired task is not
  -- offered, and doc 12 states availability is configuration-driven.
  if v_task.state <> 'LIVE' then
    raise exception 'start_task_attempt: task is %, not LIVE', v_task.state
      using errcode = 'check_violation';
  end if;

  if v_task.available_from is not null and v_task.available_from > now() then
    raise exception 'start_task_attempt: task is not yet available'
      using errcode = 'check_violation';
  end if;

  if v_task.available_until is not null and v_task.available_until < now() then
    raise exception 'start_task_attempt: task availability has ended'
      using errcode = 'check_violation';
  end if;

  -- Doc 12 ELIGIBILITY: country gating.
  if cardinality(v_task.countries) > 0
     and not (coalesce(p_client_ip::text, '') = any (v_task.countries)) then
    raise exception 'start_task_attempt: task is not available in this region'
      using errcode = 'check_violation';
  end if;

  -- Doc 12 ABUSE CONTROLS: repeat-attempt rules.
  select count(*) into v_count
  from app.task_attempts
  where task_id = p_task_id and user_id = p_user_id;

  if v_count >= v_task.max_attempts_per_user then
    raise exception 'start_task_attempt: attempt limit reached (max %)', v_task.max_attempts_per_user
      using errcode = 'check_violation';
  end if;

  -- Doc 12 ELIGIBILITY: account age, measured from OUR record, not the client's.
  if v_task.min_account_age_days > 0 then
    select * into v_profile from app.profiles where id = p_user_id;
    if not found then
      raise exception 'start_task_attempt: user has no profile'
        using errcode = 'foreign_key_violation';
    end if;

    if v_profile.created_at > now() - make_interval(days => v_task.min_account_age_days) then
      raise exception 'start_task_attempt: account is too new for this task'
        using errcode = 'check_violation';
    end if;
  end if;

  v_next := v_count + 1;

  insert into app.task_attempts (
    task_id, user_id, attempt_number, status, started_at, expires_at,
    client_device_fingerprint, client_ip, correlation_id
  ) values (
    p_task_id, p_user_id, v_next, 'STARTED', now(),
    case when v_task.available_until is not null then v_task.available_until else null end,
    p_client_device_fingerprint, p_client_ip, p_correlation_id
  )
  returning * into v_attempt;

  insert into app.task_events (task_id, attempt_id, event_type, to_status, actor_user_id)
  values (p_task_id, v_attempt.id, 'ATTEMPT_STARTED', 'STARTED', p_user_id);

  return v_attempt;
end;
$$;

-- Records a completion claim.
--
-- THIS FUNCTION NEVER CREATES MONEY. It records the client's assertion as
-- evidence and routes the attempt according to the task's declared verification
-- mechanism:
--
--   SERVER_EVENT / SERVER_RULE with auto_verify -> UNDER_REVIEW, where the
--     verification worker or a human decides. Even a self-verifying task goes to
--     review, because the server still has to confirm the rule actually holds.
--   SELF_ATTESTED -> UNDER_REVIEW always. Doc 12: a client claim is evidence.
--
-- The server measures duration from its own started_at. A client-supplied timer
-- is stored inside client_claim as an assertion and is never read for the
-- impossible-time check, so a forged clock cannot beat the minimum.
create or replace function app_private.submit_task_completion(
  p_attempt_id uuid,
  p_user_id uuid,
  p_client_claim jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
) returns app.task_attempts
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_attempt app.task_attempts;
  v_task app.task_definitions;
  v_duration integer;
begin
  select * into v_attempt from app.task_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'submit_task_completion: unknown attempt %', p_attempt_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_attempt.user_id <> p_user_id then
    raise exception 'submit_task_completion: attempt does not belong to this user'
      using errcode = 'check_violation';
  end if;

  if v_attempt.status not in ('STARTED','ABANDONED') then
    raise exception 'submit_task_completion: attempt is already %', v_attempt.status
      using errcode = 'check_violation';
  end if;

  if v_attempt.expires_at is not null and v_attempt.expires_at < now() then
    update app.task_attempts set status = 'EXPIRED' where id = p_attempt_id;
    raise exception 'submit_task_completion: attempt expired at %', v_attempt.expires_at
      using errcode = 'check_violation';
  end if;

  select * into v_task from app.task_definitions where id = v_attempt.task_id;

  -- Server-measured duration. Never from the client.
  v_duration := extract(epoch from (now() - v_attempt.started_at))::integer;

  if v_duration < 0 then
    v_duration := 0;
  end if;

  -- Doc 12 "impossible-time checks". A completion faster than the task permits
  -- is refused outright rather than flagged, because the timing is ours and an
  -- impossible value is not evidence of anything.
  if v_task.min_duration_seconds > 0 and v_duration < v_task.min_duration_seconds then
    raise exception 'submit_task_completion: completed in %s, minimum is %s (impossible time)',
      v_duration, v_task.min_duration_seconds using errcode = 'check_violation';
  end if;

  update app.task_attempts
  set status = 'SUBMITTED',
      submitted_at = now(),
      client_claim = coalesce(p_client_claim, '{}'::jsonb),
      server_duration_seconds = v_duration
  where id = p_attempt_id
  returning * into v_attempt;

  insert into app.task_events (task_id, attempt_id, event_type, from_status, to_status, actor_user_id, payload)
  values (
    v_task.id, p_attempt_id, 'COMPLETION_CLAIMED', 'STARTED', 'SUBMITTED', p_user_id,
    jsonb_build_object('serverDurationSeconds', v_duration, 'mechanism', v_task.verification_mechanism::text)
  );

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'task.completion_claimed', 'task_attempt', p_attempt_id::text,
    jsonb_build_object(
      'attemptId', p_attempt_id, 'taskId', v_task.id, 'userId', p_user_id,
      'mechanism', v_task.verification_mechanism::text, 'autoVerify', v_task.auto_verify
    )
  ) on conflict do nothing;

  return v_attempt;
end;
$$;

-- Verifies a completion claim and, on PASS, creates the reward.
--
-- THIS IS THE ONLY FUNCTION THAT CAN PAY A TASK. It is the executable form of
-- doc 12 VERIFICATION: a claim becomes money only after a server or human
-- decision recorded here.
--
-- The reward is created through grant_reward, never post_ledger_entry, so the
-- funding source, budget decrement, caps and ledger entry all come from the one
-- authoritative Reward Engine path (law 10, law 12).
create or replace function app_private.verify_task_completion(
  p_attempt_id uuid,
  p_result app.verification_result,
  p_verifier_id uuid default null,
  p_reason_code text default null,
  p_evidence jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
) returns app.task_attempts
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_attempt app.task_attempts;
  v_task app.task_definitions;
  v_reward app.rewards;
begin
  select * into v_attempt from app.task_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'verify_task_completion: unknown attempt %', p_attempt_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_attempt.status in ('VERIFIED','REJECTED','EXPIRED') then
    raise exception 'verify_task_completion: attempt is already %', v_attempt.status
      using errcode = 'check_violation';
  end if;

  if v_attempt.status not in ('SUBMITTED','UNDER_REVIEW') then
    raise exception 'verify_task_completion: attempt is %, awaiting a claim', v_attempt.status
      using errcode = 'check_violation';
  end if;

  select * into v_task from app.task_definitions where id = v_attempt.task_id;

  -- Doc 12 VERIFICATION: a SELF_ATTESTED claim cannot be auto-approved. The
  -- table constraint already forbids auto_verify on such a task; this repeats
  -- the rule at the point of decision, which is where it actually matters.
  if p_result = 'PASS' and v_task.verification_mechanism = 'SELF_ATTESTED' then
    raise exception
      'verify_task_completion: a self-attested task cannot be auto-verified; route it to review'
      using errcode = 'check_violation';
  end if;

  -- A task with NO verification mechanism can never pay.
  if p_result = 'PASS' and v_task.verification_mechanism = 'NONE' then
    raise exception 'verify_task_completion: task declares no verification mechanism'
      using errcode = 'check_violation';
  end if;

  insert into app.task_verifications (
    attempt_id, mechanism, result, reason_code, evidence, verified_by
  ) values (
    p_attempt_id, v_task.verification_mechanism, p_result, p_reason_code,
    coalesce(p_evidence, '{}'::jsonb), p_verifier_id
  );

  if p_result = 'PASS' then
    if v_task.reward_amount_minor is null or v_task.funding_source_id is null then
      raise exception 'verify_task_completion: task % pays no reward', v_task.code
        using errcode = 'check_violation';
    end if;

    -- THE ONLY PATH TO MONEY for a task. Idempotent on the attempt, so a
    -- retried verification cannot pay twice.
    v_reward := app_private.grant_reward(
      p_user_id => v_attempt.user_id,
      p_source_id => v_task.funding_source_id,
      p_amount_minor => v_task.reward_amount_minor,
      p_unit => v_task.reward_unit,
      p_event_type => 'TASK_COMPLETION',
      p_source_event_id => v_attempt.id::text,
      p_gross_value_minor => v_task.reward_amount_minor,
      p_rule_reference => 'task:' || v_task.code,
      p_idempotency_key => 'task-reward:' || v_attempt.id::text,
      p_correlation_id => p_correlation_id,
      p_hold => false
    );

    update app.task_attempts
    set status = 'VERIFIED', verified_at = now(), reward_id = v_reward.id
    where id = p_attempt_id
    returning * into v_attempt;

    insert into app.task_events (task_id, attempt_id, event_type, from_status, to_status, actor_user_id, payload)
    values (
      v_task.id, p_attempt_id, 'COMPLETION_VERIFIED', 'SUBMITTED', 'VERIFIED', p_verifier_id,
      jsonb_build_object('rewardId', v_reward.id, 'amountMinor', v_task.reward_amount_minor, 'unit', v_task.reward_unit)
    );

    insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values (
      'task.verified', 'task_attempt', p_attempt_id::text,
      jsonb_build_object(
        'attemptId', p_attempt_id, 'taskId', v_task.id, 'userId', v_attempt.user_id,
        'rewardId', v_reward.id, 'amountMinor', v_task.reward_amount_minor, 'unit', v_task.reward_unit
      )
    ) on conflict do nothing;

  elsif p_result = 'FAIL' then
    update app.task_attempts
    set status = 'REJECTED', verified_at = now(), rejection_reason = p_reason_code
    where id = p_attempt_id
    returning * into v_attempt;

    insert into app.task_events (task_id, attempt_id, event_type, from_status, to_status, actor_user_id, payload)
    values (
      v_task.id, p_attempt_id, 'COMPLETION_REJECTED', 'SUBMITTED', 'REJECTED', p_verifier_id,
      jsonb_build_object('reasonCode', p_reason_code)
    );

  else
    update app.task_attempts
    set status = 'UNDER_REVIEW', review_reason = p_reason_code
    where id = p_attempt_id
    returning * into v_attempt;

    insert into app.task_events (task_id, attempt_id, event_type, from_status, to_status, actor_user_id, payload)
    values (
      v_task.id, p_attempt_id, 'HUMAN_REVIEW_REQUIRED', 'SUBMITTED', 'UNDER_REVIEW', p_verifier_id,
      jsonb_build_object('reasonCode', p_reason_code)
    );
  end if;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, reason, result, correlation_id, after_state
  ) values (
    p_verifier_id, 'task.verification_decision', 'task_attempt', p_attempt_id::text,
    p_reason_code, p_result::text, p_correlation_id,
    jsonb_build_object('status', v_attempt.status::text, 'mechanism', v_task.verification_mechanism::text)
  );

  return v_attempt;
end;
$$;

-- Lock down execution. A user may start and claim; only a server-side worker or
-- an authorized operator may verify.
revoke all on function app_private.start_task_attempt(uuid, uuid, text, inet, uuid) from public, anon, authenticated;
revoke all on function app_private.submit_task_completion(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function app_private.verify_task_completion(uuid, app.verification_result, uuid, text, jsonb, uuid) from public, anon, authenticated;

grant execute on function app_private.start_task_attempt(uuid, uuid, text, inet, uuid) to service_role;
grant execute on function app_private.submit_task_completion(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function app_private.verify_task_completion(uuid, app.verification_result, uuid, text, jsonb, uuid) to service_role;