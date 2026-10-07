-- =============================================================================
-- Averra migration 064: Provisional provider earnings (READ ONLY, NON-PAYABLE)
--
-- WHY THIS EXISTS
--
-- CPX Research is a CANDIDATE provider, so a real callback lands as a real
-- conversion but can never become money: `apply_conversion_reward` refuses any
-- provider that is not LIVE (migration 015 line 66), and CR-0033's settlement
-- gate refuses to release a reward that no MATCHED settlement covers.
--
-- Without a read model the user sees a conversion that silently does nothing.
-- This exposes that conversion as an ESTIMATE so the attribution loop is
-- verifiable end to end, while changing no financial behaviour whatsoever.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   - no table. `app.provider_conversions` is already the record of the event,
--     and a second table would be a second place for money-shaped facts to drift.
--   - no ledger entry, no `grant_reward`, no reward row, no `AVAILABLE`
--     transition, no outbox payout, no funding source.
--   - no change to `settle_provider_period`, `transition_reward`,
--     `transition_reward_ungated`, `apply_conversion_reward`, or any other
--     command in migrations 015/034/057/059/060/063. Those files stay
--     byte-identical. This migration only ADDS a read wrapper.
--
-- "VALIDATED" IS NOT A PAYABILITY VERDICT
--
-- A VALIDATED conversion is one our ADAPTER classified as payable. CPX's
-- `status=1` semantics are still unconfirmed in writing, so VALIDATED means "we
-- accepted the callback", NOT "the provider owes us this and Averra has
-- confirmed it". The wording in the UI and the comments here both say
-- estimated/potential for that reason. Confirmed money remains the exclusive
-- property of the normal reward path.
--
-- WHY THE REVERSAL FILTER IS `NOT EXISTS` AND NOT `status <> 'REVERSED'`
--
-- A reversal is its own conversion row (migration 057, law 42), and
-- `apply_provider_reversal` returns EARLY at line 337 when the original has no
-- reward yet -- which is exactly the state every CPX conversion is in today,
-- because CPX is CANDIDATE and `reward_id` is therefore always null. In that
-- path nothing updates the original's status, so a reversed conversion still
-- reads `VALIDATED` forever.
--
-- Filtering on `status <> 'REVERSED'` would therefore show a clawback to the
-- user as still-pending estimated earnings. The only reliable signal is the
-- -----------------------------------------------------------------------------
-- Read one user's estimated provider earnings.
--
-- Scoped by `p_user_id` only. The route that calls this supplies the id from the
-- VERIFIED SESSION and never from a request body, which is what prevents one
-- signed-in user reading another's estimates. Combined with the revoke below,
-- this is both scoped AND unreachable unauthenticated (see CR-0013 / Q-22).
-- -----------------------------------------------------------------------------
create or replace function public.get_provisional_earnings(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'userId', p_user_id,
    -- Grouped BY CURRENCY, never summed into one number. A total that added
    -- NGN minor units to USD minor units would be a fabricated figure, and the
    -- whole point of the two-domain split (law 56) is that amounts of different
    -- currencies are not interchangeable.
    'byCurrency', coalesce(
      (
        select jsonb_agg(grouped.totals order by grouped.totals->>'unit')
        from (
          select jsonb_build_object(
            'unit', coalesce(c.currency, 'UNKNOWN'),
            'totalMinor', sum(c.gross_value_minor),
            'eventCount', count(*)
          ) as totals
          from app.provider_conversions c
          join app.providers p on p.id = c.provider_id
          where c.user_id = p_user_id
            -- No reward yet, so this is not part of the confirmed payable path.
            and c.reward_id is null
            -- Exclude anything a reversal points at. See the header.
            and not exists (
              select 1 from app.provider_conversions r
              where r.reverses_conversion_id = c.id
            )
            -- And exclude a row that IS itself a reversal. Those carry no user,
            -- so `c.user_id = p_user_id` already excludes them; the predicate
            -- is kept because it states the intent rather than relying on that.
            and c.reverses_conversion_id is null
            -- Terminal statuses never become earnings.
            and c.status in ('RECEIVED', 'VALIDATED')
            -- Only a non-LIVE provider is in the provisional regime at all.
            and p.lifecycle_state <> 'LIVE'
            -- An amount with no currency cannot be displayed honestly.
            and c.gross_value_minor is not null
            and c.gross_value_minor > 0
            and c.currency is not null
          group by coalesce(c.currency, 'UNKNOWN')
        ) as grouped
      ),
      '[]'::jsonb
    ),
-- link: a conversion someone else's reversal points at. That is what this
-- function excludes, and it is asserted in supabase/tests/provisional.sql.
--
'recent', coalesce(
      (
        select jsonb_agg(recent_items.item order by recent_items.item->>'attributedAt' desc)
        from (
          select jsonb_build_object(
            'conversionId', c.id,
            'providerCode', p.code,
            'eventType', c.event_type,
            'status', c.status,
            'estimatedMinor', c.gross_value_minor,
            'currency', c.currency,
            'attributedAt', c.created_at
          ) as item
          from app.provider_conversions c
          join app.providers p on p.id = c.provider_id
          where c.user_id = p_user_id
            and c.reward_id is null
            and not exists (
              select 1 from app.provider_conversions r
              where r.reverses_conversion_id = c.id
            )
            and c.reverses_conversion_id is null
            and c.status in ('RECEIVED', 'VALIDATED')
            and p.lifecycle_state <> 'LIVE'
            and c.gross_value_minor is not null
            and c.gross_value_minor > 0
            and c.currency is not null
          -- CAPPED. An unbounded list of financial amounts is how a read
          -- surface turns into a data dump. The aggregate above is the
          -- authority; this list is display detail only.
          limit 20
        ) as recent_items
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_provisional_earnings(uuid)
  from public, anon, authenticated;
grant execute on function public.get_provisional_earnings(uuid)
  to service_role;

comment on function public.get_provisional_earnings(uuid) is
  'Estimated/potential provider earnings for one user, grouped by currency and '
  'capped at 20 recent items. READ ONLY: creates no ledger entry, no reward, no '
  'payout and no outbox event, and is not part of any withdrawal path. Excludes '
  'conversions a reversal points at, conversions that already carry a reward, '
  'and every LIVE provider. A VALIDATED status means the callback was accepted, '
  'NOT that the provider confirmed the amount is payable.';
-- WHY PROVIDER SCOPE IS NOT HARD-CODED
--
-- The rule is "any provider that is not LIVE", evaluated in SQL against
-- `lifecycle_state`, so promoting CPX or adding a second CANDIDATE provider
-- needs no code change (law 12). A LIVE provider's conversions have already
-- entered the real reward path and are excluded twice over: by the lifecycle
-- check here, and by the `reward_id is null` check below.
-- =============================================================================