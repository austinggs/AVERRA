-- =============================================================================
-- Averra migration 061: Settlement currency fallback
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt RECONCILIATION
--
-- WHY THIS EXISTS RATHER THAN AN EDIT TO 059
--
-- Migration 059 is APPLIED. Editing it would change the file without changing the
-- database, and `db push` would still print success because
-- `supabase_migrations.schema_migrations` records a version, never a checksum. Both
-- paths converge only if the applied file is left byte-identical and the definition is
-- corrected forward - see AGENTS.md, "an applied migration is frozen".
--
-- THE DEFECT
--
-- `settle_provider_period` wrote `provider_settlements.currency` from
--
--     (select settlement_currency from app.providers where id = p_provider_id)
--
-- and `app.provider_settlements.currency` is NOT NULL. A provider that has not
-- configured a settlement currency - which is every CANDIDATE provider, including
-- cpx_research - makes that subquery return NULL, so the INSERT dies with
--
--     null value in column "currency" ... violates not-null constraint
--
-- and the command cannot record a settlement AT ALL. The failure is worst exactly
-- where it matters most: reconciliation is the control that makes an unsettled
-- conversion safe, and it was unreachable for every provider not yet LIVE.
--
-- Note the shape of this. A NOT NULL violation is normally the database working. Here
-- it was a code path that assumed configuration this repository deliberately has not
-- supplied - the same class as the Q-43 enum comparisons, where a wrong assumption
-- produced a value that was always false and nothing threw.
--
-- THE FIX
--
-- Coalesce to 'UNSPECIFIED'. The alternative - refusing to record a report we cannot
-- currency-tag - was rejected: a variance we could not write down is a variance we
-- could not act on, which is strictly worse than one labelled UNSPECIFIED.
--
-- This does not weaken any gate. reconcile_provider_period still computes the expected
-- figures from our own CONVERTED conversions and never reads this column, so the
-- MATCHED/VARIANCE decision is unchanged by what the currency is labelled.
-- =============================================================================

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

  -- BOTH figures must agree. An amount that matches while the count does not means
  -- our records describe a different set of events that happens to total the same,
  -- which is precisely the shape a forgery takes.
  if v_variance = 0 and p_reported_conversion_count = v_expected_count then
    v_status := 'MATCHED';
  else
    v_status := 'VARIANCE';
  end if;

  insert into app.provider_settlements (
    provider_id, provider_reference, period_start, period_end, currency,
    reported_amount_minor, reported_conversion_count,
    expected_amount_minor, expected_conversion_count, variance_minor, status,
    variance_reason
  )
  values (
    p_provider_id, trim(p_provider_reference), p_period_start, p_period_end,
    -- THE FIX. A CANDIDATE provider has no settlement_currency and this column is
    -- NOT NULL, so the original subquery aborted the whole INSERT for exactly the
    -- providers reconciliation exists to protect.
    coalesce(
      (select settlement_currency from app.providers where id = p_provider_id),
      'UNSPECIFIED'
    ),
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
        -- database. supabase/tests/provider_attribution.sql asserts the revoke for
        -- every application role rather than trusting this comment.
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
  '(doc 08 RECONCILIATION, law 6, law 25). Migration 061: currency falls back to '
  'UNSPECIFIED for a provider with no settlement currency configured.';