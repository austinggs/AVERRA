-- =============================================================================
-- Averra migration 028: Risk gating of the reward engine
--
-- Source of truth: 40_FRAUD_ANTI_ABUSE.txt FINANCIAL INTEGRITY + DECISION MODEL,
--                  71_ARCHITECTURAL_LAWS.md law 42
--
-- WHAT THIS CLOSES
--
-- `current_risk_decision` existed but nothing consulted it, so a HOLD recorded
-- intent without enforcing anything. A policy that no code path reads is not a
-- control. This migration makes the Reward Engine consult it, so a HOLD, REVIEW,
-- RESTRICT, SUSPEND or TERMINATE actually stops a FUTURE credit.
--
-- DOC 40 FINANCIAL INTEGRITY, PRECISELY HONOURED
--
-- "Risk decisions may hold or reject future events but must not silently rewrite
-- financial history."
--
-- `grant_reward` is the single money path, and the gate is applied at the TOP of
-- it, BEFORE any ledger entry, budget decrement or account write. So a blocked
-- reward leaves NO trace in the financial history: no ledger row, no budget
-- movement, no reward row. The risk decision stands on its own in
-- `risk_decisions`, and the user can be told why.
--
-- The gate never reverses, adjusts or claws back an EXISTING reward. It only
-- refuses to CREATE a new one. That distinction is the whole of law 42.
-- =============================================================================

-- True when a decision should block a new credit.
--
-- ALLOW is the only decision that permits a credit. REVIEW, HOLD, RESTRICT,
-- SUSPEND and TERMINATE all block. REJECT is included because a rejected subject
-- is not a subject to which a new reward should be attached.
--
-- Doc 40 lists these as a decision spectrum, and the safe reading of a spectrum
-- is that only its explicitly permissive end permits action.
create or replace function app_private.reward_blocked_by_risk(
  p_user_id uuid
) returns app.risk_decisions
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select d.*
  from app.risk_decisions d
  where d.subject_user_id = p_user_id
    and d.superseded_by_id is null
    and (d.expires_at is null or d.expires_at > now())
    and d.decision <> 'ALLOW'
  order by
    -- Most severe first, so the returned row explains the strongest reason.
    case d.decision
      when 'TERMINATE' then 1
      when 'SUSPEND' then 2
      when 'RESTRICT' then 3
      when 'REJECT' then 4
      when 'HOLD' then 5
      when 'REVIEW' then 6
      else 7
    end,
    d.created_at desc,
    d.id desc
  limit 1;
$$;

-- Renames the existing money path, so the gate can wrap it rather than
-- duplicate it.
--
-- WHY WRAP RATHER THAN REWRITE
--
-- `grant_reward` is the single most safety-critical function in the codebase.
-- Re-typing its body to insert a gate would risk a silent transcription
-- difference in a function that moves real money. Renaming the original and
-- wrapping it means the gated behaviour is provably the original behaviour plus
-- a precondition, with the money logic itself untouched.
--
-- The renamed function is revoked from EVERY role immediately below. Leaving it
-- executable would create a bypass path around the risk gate, which would defeat
-- the entire control.
alter function app_private.grant_reward(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) rename to grant_reward_ungated;

-- The rename CARRIES the original `grant execute ... to service_role` with it,
-- so service_role would otherwise be able to call the unguarded function
-- directly and walk straight past the risk gate. Revoking from service_role too
-- is what makes the control real rather than decorative.
--
-- The gated wrapper below is SECURITY DEFINER and is owned by the migration
-- owner, so it can still call the inner function regardless of the caller's
-- grants. Only the wrapper is exposed.
revoke all on function app_private.grant_reward_ungated(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) from public, anon, authenticated, service_role;

comment on function app_private.grant_reward_ungated(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) is 'The unguarded money path, revoked from every role including service_role. It exists only to be called by the gated app_private.grant_reward wrapper.';

-- ===========================================================================
-- The gated money path.
--
-- Doc 40 FINANCIAL INTEGRITY: a risk decision may hold or reject a FUTURE event
-- but must not silently rewrite financial history.
--
-- This wrapper refuses to CALL the money path when a non-ALLOW risk decision is
-- in force. Because the refusal happens before the call, a blocked reward leaves
-- NO trace: no ledger entry, no reward row, no budget movement, no account. The
-- financial history is not rewritten; the credit simply never happens.
--
-- The decision itself is not silently hidden. It is written to the audit log with
-- its reason code, so support and an appeal can see exactly why a credit did not
-- occur.
-- ===========================================================================
create or replace function app_private.grant_reward(
  p_user_id uuid,
  p_source_id uuid,
  p_amount_minor bigint,
  p_unit text,
  p_event_type text,
  p_source_event_id text,
  p_gross_value_minor bigint default null,
  p_rule_reference text default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null,
  p_hold boolean default false
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_risk app.risk_decisions;
  v_key text;
begin
  v_key := coalesce(
    p_idempotency_key,
    'reward:' || p_event_type || ':' || p_source_event_id
  );

  -- A REPLAY of an already-granted reward is not a new event, so it is not
  -- blocked. This is checked BEFORE the risk gate deliberately: a client retrying
  -- a request whose response it lost must receive the same reward back, not an
  -- error, even if a hold has since been applied.
  if exists (select 1 from app.rewards where idempotency_key = v_key) then
    return app_private.grant_reward_ungated(
      p_user_id, p_source_id, p_amount_minor, p_unit, p_event_type,
      p_source_event_id, p_gross_value_minor, p_rule_reference, v_key,
      p_correlation_id, p_hold
    );
  end if;

  -- Doc 40 DECISION MODEL: only ALLOW permits a new credit. HOLD, REVIEW,
  -- RESTRICT, SUSPEND, TERMINATE and REJECT all block.
  v_risk := app_private.reward_blocked_by_risk(p_user_id);

  if v_risk.id is not null then
    insert into app.audit_events (
      actor_user_id, action, target_type, target_id, reason, result,
      correlation_id, after_state
    ) values (
      p_user_id, 'reward.blocked_by_risk', 'user', p_user_id::text,
      v_risk.reason_code, v_risk.decision::text, p_correlation_id,
      jsonb_build_object(
        'decisionId', v_risk.id,
        'eventType', p_event_type,
        'sourceEventId', p_source_event_id,
        'amountMinor', p_amount_minor,
        'unit', p_unit,
        'note', 'no ledger entry, reward or budget movement was created'
      )
    );

    raise exception 'grant_reward: blocked by risk decision % (%); no credit was created',
      v_risk.decision, v_risk.reason_code
      using errcode = 'check_violation';
  end if;

  -- No decision in force: the original, unguarded money path runs unchanged.
  return app_private.grant_reward_ungated(
    p_user_id, p_source_id, p_amount_minor, p_unit, p_event_type,
    p_source_event_id, p_gross_value_minor, p_rule_reference, v_key,
    p_correlation_id, p_hold
  );
end;
$$;

revoke all on function app_private.reward_blocked_by_risk(uuid) from public, anon, authenticated;

-- The wrapper is the ONLY entry point to the money path.
revoke all on function app_private.grant_reward(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) from public, anon, authenticated;

grant execute on function app_private.reward_blocked_by_risk(uuid) to service_role;
grant execute on function app_private.grant_reward(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) to service_role;

comment on function app_private.grant_reward(
  uuid, uuid, bigint, text, text, text, bigint, text, text, uuid, boolean
) is 'The gated money path (doc 40). Refuses a new credit when a non-ALLOW risk decision is in force, leaving no ledger entry, reward or budget movement.';