-- =============================================================================
-- Averra migration 066: The settlement maturity gate
--
-- Source of truth: CPX Research Publisher Terms (advertiser validation window)
--                  and 08_PROVIDER_INTEGRATION.txt RECONCILIATION
--
-- WHY THIS EXISTS RATHER THAN AN EDIT TO 059 OR 061
--
-- Both are APPLIED. Editing either would change the file without changing the
-- database, and `db push` would still print success because
-- `supabase_migrations.schema_migrations` records a version, never a checksum.
-- Both paths converge only if the applied files are left byte-identical and the
-- definition is corrected forward - see AGENTS.md, "an applied migration is frozen".
--
-- THE DEFECT: A REVERSAL THAT ARRIVES AFTER THE USER HAS BEEN PAID
--
-- The settlement gate added in CR-0033 makes money correct at the moment it is
-- released. It does not make that release durable.
--
-- Read the four lines together, in this order:
--
--   1. `post_ledger_entry` (migration 004) REFUSES to let a user-facing balance go
--      negative:
--           if v_account.domain in ('EARNED_REWARD','USER_FUNDING')
--              and v_new_balance < 0 then raise exception 'insufficient funds'
--
--   2. Reserving a withdrawal DEBITS EARNED_REWARD (migration 007). So once a user
--      withdraws, their earned balance is zero.
--
--   3. `reverse_reward` (migration 010) reverses a reward by DEBITING
--      EARNED_REWARD by the full reward amount.
--
--   4. `settle_provider_period` (migration 059) checked exactly ONE thing about the
--      period: `p_period_end <= p_period_start`. Nothing required the period to be
--      old. An operator could settle a period one week after it closed.
--
-- CPX's publisher terms give the ADVERTISER a 60 to 90 day window to retroactively
-- flag a completion as fraudulent or invalid, and the advertiser - not CPX - makes
-- that call. A devalidation is therefore re-notified as `status=-2` against the SAME
-- trans_id, possibly ninety days after the user was paid.
--
-- So the failure is not an edge case. It is the expected path for every
-- devalidation:
--
--   Day 0    survey completed, status=1, reward PENDING
--   Day 7    operator settles a period that closed on day 6; reward AVAILABLE
--   Day 8    user withdraws; EARNED_REWARD debited to zero
--   Day 75   advertiser devalidates; CPX re-notifies status=-2
--            -> reverse_reward DEBITS EARNED_REWARD
--            -> balance would be -NGN 500 -> post_ledger_entry RAISES
--            -> the whole transaction aborts
--
-- The conversion is never marked REVERSED, the reward is never reversed, and
-- `evidence.ts` records REVERSAL_APPLY_FAILED against the callback. CPX's dashboard
-- shows the clawback as delivered. The money is gone.
--
-- There is no debt, recovery, overdraft or write-off mechanism anywhere in this
-- repository (grepped across every migration and `src/`: zero hits). So this is not
-- a recoverable loss - it is a silent one, and it is the third instance of the
-- discard family in this integration after CR-0030's routing and CR-0032's event
-- identity.
--
-- THE FIX
--
-- Do not release money for a period until that period is older than the
-- advertiser's right to devalidate it. The window is anchored on `p_period_end`,
-- NOT `p_period_start`, because `p_period_end` bounds the YOUNGEST conversion in
-- the period: a period that ended ninety-one days ago has had ninety-one days of
-- advertiser exposure, a period that started ninety-one days ago has not.
--
--     p_period_end <= now() - interval '90 days'
--
-- At that point every conversion in the period has survived CPX's advertiser
-- window, so a later `status=-2` is either a vendor error or a genuine fraud
-- finding we would still want to record - but it can no longer arrive against a
-- balance that has already left.
--
-- DELIBERATELY NOT CONFIGURABLE
--
-- There is no parameter, no provider column and no settings row for this window,
-- and that is the point. A tunable window is a defect one UPDATE away from
-- returning, and the failure mode when it is lowered is silent. This matches the
-- reasoning already applied to AVAILABLE in `transition_reward` (migration 059):
-- no parameter exists that could wave it through, because there is no parameter at
-- all. If a future provider genuinely needs a different window, that provider
-- needs a different command - not a column somebody can set to zero.
--
-- WHAT THIS DOES NOT DO
--
-- It does not weaken reconciliation. `reconcile_provider_period` keeps computing
-- both figures from our own CONVERTED conversions, and the MATCHED gate is
-- untouched: a VARIANCE still settles nothing.
--
-- It does not block investigation. The maturity check lives ONLY in
-- `settle_provider_period`. `reconcile_provider_period` is deliberately ungated,
-- because reporting on an immature period is exactly how an operator investigates
-- one, and refusing to reconcile would only push them toward a manual UPDATE.
--
-- It does not change the function signature, so the `public` wrapper added by
-- migration 065 still resolves with its seven positional arguments.
--
-- THE COST, STATED PLAINLY
--
-- Users wait about ninety days longer to be paid, because that is how long CPX's
-- network takes to decide whether a completion is real. That is a product cost and
-- it is deliberate: the alternative is paying users and being unable to take the
-- money back. The first settlement for any new provider is correspondingly delayed.
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

  -- THE MATURITY GATE. Placed before reconciliation so an immature report writes
  -- nothing at all: no settlement row, no audit event, no transition. The operator
  -- simply retries once the window has closed, and nothing has to be undone.
  --
  -- The message carries no interpolated values so pgTAP can assert it by exact
  -- equality (throws_ok is not a pattern match). The dates go to DETAIL, which
  -- operators see in the error and SQLERRM does not contain.
  if p_period_end > now() - interval '90 days' then
    raise exception 'settle_provider_period: period_end is inside the 90-day maturity window'
      using errcode = 'check_violation',
            detail = format(
              -- `%%`, not `%`. format() raises "unrecognized format() type specifier"
              -- on a bare `%` followed by anything but s/I/L/%, which would replace the
              -- intended message with a format error and break the exact-message
              -- pgTAP assertion. Nothing here interpolates user input.
              'period_end %% is not yet %s. Conversions in this period can still be '
              'devalidated by the advertiser and re-notified as status=-2, and a '
              'user who has already withdrawn cannot be debited.',
              p_period_end, (now() - interval '90 days')::timestamptz
            );
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
    -- Unchanged from migration 061, which introduced it: a CANDIDATE provider has
    -- no settlement_currency and this column is NOT NULL.
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

-- Restated byte-identically from 061 so this file is self-contained and so
-- `check:grants` has a local definition to read. A `create or replace` preserves
-- the existing ACL, so this is belt-and-braces rather than a fix.
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
  'UNSPECIFIED for a provider with no settlement currency configured. Migration 066: a '
  'period must be at least 90 days old, because CPX''s advertiser can devalidate a '
  'completion for up to 90 days afterwards and a user who has already withdrawn cannot '
  'be debited.';
