-- =============================================================================
-- Averra migration 059: Settlement-gated reward availability
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt RECONCILIATION and FINANCIAL
-- BOUNDARY, 35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt, 30 (a provider
-- conversion is a liability), 71_ARCHITECTURAL_LAWS.md laws 6/7/10/25
--
-- THE DEFECT THIS EXISTS TO CLOSE
--
-- Migration 015's comment claimed: "a provider conversion is a liability, not
-- immediately spendable money. It settles via transition_reward once settlement is
-- confirmed."
--
-- The first sentence is true. The second was a wish. `app_private.transition_reward`
-- refuses only the REVERSING states and terminal states; it places no condition on
-- AVAILABLE at all. Any caller holding EXECUTE could move a PENDING provider reward
-- straight to AVAILABLE, making a value the provider has not yet paid for
-- withdrawable.
--
-- Nothing ever called it that way, and the provider was CANDIDATE, so no money was
-- ever at risk. That is luck, not a control, and it stops the moment a provider goes
-- LIVE. This migration replaces the luck with an invariant.
--
-- THE CHOICE: REVOKE, NOT A NEW PARAMETER
--
-- `transition_reward` is APPLIED and its reviewed body is left byte-identical. The
-- obvious alternative - adding a p_settlement_id to it - was rejected for the same
-- reason CR-0032 rejected adding a parameter to `record_provider_conversion`: an
-- applied migration is the authoritative record of what the database received.
--
-- So the AVAILABLE path is closed from the OUTSIDE instead, the same shape as
-- CR-0028's `grant_reward` / `grant_reward_ungated` split:
--
--   * a new private `transition_reward_ungated` carries the original body
--   * `transition_reward` becomes a thin SECURITY DEFINER wrapper that refuses
--     `AVAILABLE` outright and forwards everything else
--   * EXECUTE on the ungated function is revoked from EVERY role, including
--     service_role, because a rename carries the original grant with it
--   * only `settle_provider_period` - which demands a MATCHED settlement - can reach
--     AVAILABLE, and it calls the ungated function directly
--
-- LAW 6: a granted reward is PENDING or ON_HOLD, never AVAILABLE. Availability is a
-- separate settlement transition, and for a provider that transition now requires
-- evidence the provider actually paid.
-- =============================================================================

create or replace function app_private.transition_reward_ungated(
  p_reward_id uuid,
  p_to_state app.reward_state,
  p_reason_code text default null,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_reward app.rewards;
  v_from app.reward_state;
begin
  select * into v_reward from app.rewards where id = p_reward_id for update;
  if not found then
    raise exception 'transition_reward: unknown reward %', p_reward_id
      using errcode = 'foreign_key_violation';
  end if;

  v_from := v_reward.state;

  if p_to_state = v_from then
    return v_reward;
  end if;

  -- Terminal states are final. Nothing resurrects a reversed reward.
  if v_from in ('REVERSED','CANCELLED','EXPIRED') then
    raise exception 'transition_reward: reward is already terminal (%)', v_from
      using errcode = 'check_violation';
  end if;

  -- A reversal must go through reverse_reward, which posts the compensating
  -- ledger entry. A bare transition here would mark a reward reversed without
  -- the money ever being compensated (law 7).
  if p_to_state in ('REVERSED','CHARGEBACK') then
    raise exception 'transition_reward: use reverse_reward for a reversing transition'
      using errcode = 'check_violation';
  end if;

  update app.rewards
  set state = p_to_state, state_changed_at = now()
  where id = p_reward_id
  returning * into v_reward;

  insert into app.reward_state_transitions (reward_id, from_state, to_state, reason_code, actor_user_id)
  values (p_reward_id, v_from, p_to_state, p_reason_code, p_actor_id);

  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'reward.state_changed', 'reward', p_reward_id::text,
    jsonb_build_object(
      'rewardId', p_reward_id, 'from', v_from::text,
      'to', p_to_state::text, 'reasonCode', p_reason_code
    )
  ) on conflict do nothing;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, before_state, after_state
  )
  values (
    p_actor_id, 'reward.state_changed', 'reward', p_reward_id::text, 'SUCCESS', p_correlation_id,
    jsonb_build_object('state', v_from::text),
    jsonb_build_object('state', p_to_state::text)
  );

  return v_reward;
end;
$$;

-- REVOKED FROM EVERY ROLE, INCLUDING service_role.
--
-- This is the load-bearing line of the whole migration and it is easy to get wrong.
-- `create or replace` under a new name is a RENAME of an existing function, and a
-- rename carries the original's ACL with it. Writing only
-- `revoke ... from public, anon, authenticated` would leave service_role holding
-- EXECUTE and the gate would be decorative. `supabase/tests/provider_attribution.sql`
-- asserts this for every role including postgres.
revoke all on function app_private.transition_reward_ungated(uuid, app.reward_state, text, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function app_private.transition_reward_ungated(uuid, app.reward_state, text, uuid, uuid) is
  'The original transition_reward body, renamed. Reachable ONLY from settle_provider_period. '
  'EXECUTABLE by no role; settlement is the only path to AVAILABLE (law 6).';


-- -----------------------------------------------------------------------------
-- The gated wrapper. Every state EXCEPT AVAILABLE.
-- -----------------------------------------------------------------------------
create or replace function app_private.transition_reward(
  p_reward_id uuid,
  p_to_state app.reward_state,
  p_reason_code text default null,
  p_actor_id uuid default null,
  p_correlation_id uuid default null
) returns app.rewards
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  -- The gate. Refused here, by EVERY caller, including service_role and including
  -- internal code. There is no parameter a caller can pass to wave this through,
  -- because there is no parameter at all - that is the point of closing it outside
  -- the body rather than inside it.
  if p_to_state = 'AVAILABLE' then
    raise exception
      'transition_reward: AVAILABLE is settlement-gated; use settle_provider_period'
      using errcode = 'check_violation';
  end if;

  return app_private.transition_reward_ungated(
    p_reward_id, p_to_state, p_reason_code, p_actor_id, p_correlation_id
  );
end;
$$;

revoke all on function app_private.transition_reward(uuid, app.reward_state, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.transition_reward(uuid, app.reward_state, text, uuid, uuid)
  to service_role;

comment on function app_private.transition_reward(uuid, app.reward_state, text, uuid, uuid) is
  'Every reward transition EXCEPT AVAILABLE. AVAILABLE is refused unconditionally and '
  'is reachable only through settle_provider_period (law 6).';


-- -----------------------------------------------------------------------------
-- Reconciliation: what our own records said, computed and never trusted from the
-- report.
-- -----------------------------------------------------------------------------
--
-- Doc 08 RECONCILIATION: "Scheduled jobs compare provider events, local conversions,
-- reward ledger entries, and settlement reports; mismatches are queued for
-- investigation."
--
-- `app.provider_settlements` (migration 014) already carried `expected_amount_minor`
-- with the comment "Computed, not trusted." Nothing computed it, so every settlement
-- row would have been MATCHED-by-absence. This function computes it.
--
-- WHAT COUNTS AS EXPECTED, AND WHY
--
-- Only CONVERTED conversions - the ones that actually became an obligation - are
-- expected to appear in a settlement report. Counting RECEIVED or VALIDATED rows here
-- would report a variance every time we correctly declined to pay something, and a
-- reconciliation that cries wolf is a reconciliation nobody runs.
--
-- REVERSED is excluded for the same reason, and that exclusion is a FEATURE: it is
-- what makes a forged conversion visible as MISSING_PROVIDER. A forgery is a CONVERTED
-- row the provider's report will never contain, so it shows up as a variance rather
-- than being quietly absorbed.
create or replace function app_private.reconcile_provider_period(
  p_provider_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_expected_amount bigint;
  v_expected_count integer;
  v_reversals integer;
begin
  if p_period_end <= p_period_start then
    raise exception 'reconcile_provider_period: period_end must be after period_start'
      using errcode = 'check_violation';
  end if;

  select
    coalesce(sum(c.gross_value_minor), 0),
    count(*)
  into v_expected_amount, v_expected_count
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.status = 'CONVERTED'
    and c.created_at >= p_period_start
    and c.created_at < p_period_end;

  -- Reversals inside the window are reported separately rather than netted off. A
  -- netted figure hides the clawback; this way an operator sees both numbers and can
  -- tell a fraud clawback from a reporting difference.
  select count(*)
  into v_reversals
  from app.provider_conversions c
  where c.provider_id = p_provider_id
    and c.status = 'REVERSED'
    and c.created_at >= p_period_start
    and c.created_at < p_period_end;

  return jsonb_build_object(
    'expectedAmountMinor', v_expected_amount,
    'expectedConversionCount', v_expected_count,
    'reversalCount', v_reversals
  );
end;
$$;

revoke all on function app_private.reconcile_provider_period(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.reconcile_provider_period(uuid, timestamptz, timestamptz)
  to service_role;

comment on function app_private.reconcile_provider_period(uuid, timestamptz, timestamptz) is
  'Computes what OUR OWN records say a provider period contained: the amount and count '
  'of CONVERTED conversions. Never trusts the reported figures. Excludes REVERSED so a '
  'forged conversion surfaces as a variance rather than being absorbed (doc 08).';


-- -----------------------------------------------------------------------------
-- The settlement gate itself.
-- -----------------------------------------------------------------------------
--
-- Records a provider's reported figures for a period, compares them against our own,
-- and - ONLY when the period reconciles exactly - makes that period's rewards
-- AVAILABLE.
--
-- WHY A PARTIAL MATCH SETTLES NOTHING
--
-- If reported_amount is 100 and ours is 90, we do not settle 90% of the period. We
-- settle nothing and queue a variance. Pro-rating would require deciding which ten
-- are the real ones, and no evidence we hold distinguishes them. Holding everything
-- is recoverable; releasing money we cannot account for is not (law 25).
--
-- THE PERIOD IS THE PROVIDER'S, NOT THE OPERATOR'S
--
-- period_start and period_end are taken verbatim from the report. An operator must not
-- be able to assert arbitrary dates that happen to exclude inconvenient conversions;
-- the boundaries come from the vendor and we only compute inside them.
--
-- Both figures must agree. An amount that matches while the count does not means our
-- records describe a different set of events that happens to total the same, which is
-- precisely the shape a forgery takes.
create or replace function app_private.settle_provider_period(
  p_provider_id uuid,
  p_provider_reference text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_reported_amount_minor bigint,
  p_reported_conversion_count integer,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_recon jsonb;
  v_expected_amount bigint;
  v_expected_count integer;
  v_reversals integer;
  v_variance bigint;
  v_status app.reconciliation_status;
  v_settlement_id uuid;
  v_settled_count integer := 0;
  v_row app.provider_conversions;
begin
  if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
    raise exception 'settle_provider_period: a provider reference is required'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_reported_amount_minor is null or p_reported_amount_minor < 0 then
    raise exception 'settle_provider_period: reported amount must be non-negative'
      using errcode = 'check_violation';
  end if;

  if p_reported_conversion_count is null or p_reported_conversion_count < 0 then
    raise exception 'settle_provider_period: reported count must be non-negative'
      using errcode = 'check_violation';
  end if;

  if p_period_end <= p_period_start then
    raise exception 'settle_provider_period: period_end must be after period_start'
      using errcode = 'check_violation';
  end if;

  v_recon := app_private.reconcile_provider_period(
    p_provider_id, p_period_start, p_period_end
  );

  v_expected_amount := (v_recon->>'expectedAmountMinor')::bigint;
  v_expected_count := (v_recon->>'expectedConversionCount')::integer;
  v_reversals := (v_recon->>'reversalCount')::integer;
  v_variance := p_reported_amount_minor - v_expected_amount;

  if v_variance = 0 and p_reported_conversion_count = v_expected_count then
    v_status := 'MATCHED';
  else
    v_status := 'VARIANCE';
  end if;

  -- provider_reference is unique per provider, so re-reporting the same period
  -- resolves the existing row instead of creating a second settlement for it.
  insert into app.provider_settlements (
    provider_id, provider_reference, period_start, period_end, currency,
    reported_amount_minor, reported_conversion_count,
    expected_amount_minor, expected_conversion_count, variance_minor, status,
    variance_reason
  )
  values (
    p_provider_id, trim(p_provider_reference), p_period_start, p_period_end,
    -- NOTE: as applied, this was the bare subquery with no COALESCE, which aborts the
    -- INSERT on a NOT NULL violation for any provider with no settlement_currency.
    -- Migration 061 corrects it forward. 059 is APPLIED and is left byte-identical to
    -- what the database received - the fix lives in 061, not here.
    (select settlement_currency from app.providers where id = p_provider_id),
    p_reported_amount_minor, p_reported_conversion_count,
    v_expected_amount, v_expected_count, v_variance, v_status,
    case when v_status = 'VARIANCE' then
      'reported ' || p_reported_amount_minor || '/' || p_reported_conversion_count
      || ' vs expected ' || v_expected_amount || '/' || v_expected_count
    else null end
  )
  on conflict (provider_id, provider_reference) do update
    set reported_amount_minor = excluded.reported_amount_minor,
        reported_conversion_count = excluded.reported_conversion_count,
        expected_amount_minor = excluded.expected_amount_minor,
        expected_conversion_count = excluded.expected_conversion_count,
        variance_minor = excluded.variance_minor,
        status = excluded.status,
        variance_reason = excluded.variance_reason
  returning id into v_settlement_id;

-- THE GATE. A VARIANCE settles nothing at all.
  if v_status = 'MATCHED' then
    -- Re-read through the settlement so a re-report that re-flips to VARIANCE cannot
    -- leave rewards AVAILABLE from the earlier MATCHED run. Without this, a period
    -- settled once and then corrected would keep its money.
    if (select status from app.provider_settlements where id = v_settlement_id) <> 'MATCHED' then
      v_status := 'VARIANCE';
    else
      for v_row in
        select c.* from app.provider_conversions c
        where c.provider_id = p_provider_id
          and c.status = 'CONVERTED'
          and c.reward_id is not null
          and c.created_at >= p_period_start
          and c.created_at < p_period_end
        order by c.created_at, c.id
        for update of c
      loop
        -- The ungated call, which is the ONLY reachable path to AVAILABLE in this
        -- database. If that revoke is ever undone, this stops being the only path -
        -- which is why supabase/tests/provider_attribution.sql asserts the revoke for
        -- every role rather than trusting the comment above.
        perform app_private.transition_reward_ungated(
          v_row.reward_id, 'AVAILABLE',
          'provider_settlement:' || p_provider_reference,
          null, p_correlation_id
        );
        v_settled_count := v_settled_count + 1;
      end loop;
    end if;
  end if;

  insert into app.audit_events (
    actor_user_id, action, target_type, target_id, result, correlation_id, after_state
  )
  values (
    null, 'provider.period_settled', 'provider_settlement', v_settlement_id::text,
    'SUCCESS', p_correlation_id,
    jsonb_build_object(
      'status', v_status::text,
      'settledCount', v_settled_count,
      'reportedAmountMinor', p_reported_amount_minor,
      'expectedAmountMinor', v_expected_amount,
      'varianceMinor', v_variance
    )
  );

  return jsonb_build_object(
    'settlementId', v_settlement_id,
    'status', v_status::text,
    'settledCount', v_settled_count,
    'reportedAmountMinor', p_reported_amount_minor,
    'expectedAmountMinor', v_expected_amount,
    'expectedConversionCount', v_expected_count,
    'varianceMinor', v_variance,
    'reversalCount', v_reversals
  );
end;
$$;

revoke all on function app_private.settle_provider_period(
  uuid, text, timestamptz, timestamptz, bigint, integer, uuid
) from public, anon, authenticated;
grant execute on function app_private.settle_provider_period(
  uuid, text, timestamptz, timestamptz, bigint, integer, uuid
) to service_role;

comment on function app_private.settle_provider_period(uuid, text, timestamptz, timestamptz, bigint, integer, uuid) is
  'Records a provider settlement report for a period and, ONLY on an exact match of both '
  'amount and count, transitions that period''s PENDING rewards to AVAILABLE through '
  'transition_reward_ungated. A VARIANCE settles nothing and is queued for investigation '
  '(doc 08 RECONCILIATION, law 6, law 25).';