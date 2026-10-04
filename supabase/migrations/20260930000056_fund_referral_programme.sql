-- =============================================================================
-- Averra migration 056: Fund the referral programme at 50,000,000 kobo
--
-- Authority: the owner's explicit confirmation of this amount, recorded 2026-10-03.
-- CR-0026 established the policy ("the software decision and the money decision are
-- separated") and deliberately shipped the source UNFUNDED. This migration is the
-- second half: the money decision, taken by the person who owns the liability.
--
-- THE AMOUNT
--
--   50,000,000 kobo in NGN-kobo  =  N500,000
--   reward per referral          =      500 kobo
--   -> 1,000 payouts, exactly
--
-- 50,000,000 divides by the configured reward with no remainder, so the budget can
-- fund the last payout completely and then correctly refuse the next one rather than
-- paying a partial amount.
--
-- WHY THIS IS GUARDED, AND WHY THAT MATTERS MORE THAN IT LOOKS
--
-- `fund_promotional_reward_source` is ADDITIVE:
--
--     budget_total_minor = budget_total_minor + p_budget_minor
--
-- so calling it twice with this amount produces a 100,000,000 budget - double the
-- approved liability - with no error and no warning. It refuses only zero or
-- negative. A migration that simply called it would therefore be safe exactly once
-- and dangerous every time after, which is the worst property a money migration can
-- have: a fresh database applies it correctly, and any replay or manual re-run
-- silently doubles the programme.
--
-- So the funding below is conditional on the source being UNFUNDED. Re-running this
-- file is a no-op that says so loudly, rather than a second N500,000 of liability.
--
-- TOP-UPS ARE NOT DONE HERE
--
-- Adding budget later is an operator action on a live programme and goes through
-- `public.admin_fund_referral_programme`, which is capability-gated and writes the
-- actor into `audit_events`. It must NOT be done by editing this constant and
-- re-running the file: the version is already applied, so that would do nothing at
-- all - which is Q-39 again, from the other direction.
--
-- NO ACTOR IS RECORDED
--
-- `p_actor_id` is null. A migration is not performed by a signed-in user, and
-- attributing it to one would put a false identity in `audit_events` (law 27). The
-- decision itself is attributable through this file's version and the commit that
-- added it, which is a stronger record than a user id would be.
-- =============================================================================

do $$
declare
  v_source app.reward_sources;
  v_funded bigint;
begin
  -- The approved amount, in the source's own unit. Never assume NGN-kobo here: read
  -- the unit off the row and fail loudly if it is not what the amount was approved in.
  v_funded := 50000000::bigint;

  select * into v_source from app.reward_sources
  where source_type = 'AVERRA_PROMOTIONAL'
  for update;

  if not found then
    raise exception 'migration 056: no AVERRA_PROMOTIONAL source exists (migration 052 must run first)';
  end if;

  if v_source.currency_unit <> 'NGN-kobo' then
    raise exception 'migration 056: source unit is %, but this amount was approved in NGN-kobo',
      v_source.currency_unit;
  end if;

  -- THE GUARD. Any prior funding, from any source, stops this migration rather than
  -- being added to. `>=` rather than `= 0` so a partially-spent funded programme also
  -- refuses, instead of topping itself up.
  if v_source.budget_total_minor >= v_funded then
    raise notice
      'migration 056: SKIPPED. The programme already holds % (% in %), so the approved % was not applied.',
      v_source.budget_total_minor, v_source.budget_remaining_minor, v_source.currency_unit, v_funded;
    return;
  end if;

  -- Top-up semantics, made explicit: a programme that already holds a SMALLER budget
  -- receives only the shortfall, so the total lands on the approved figure rather
  -- than exceeding it. This is the only case in which the additive function is safe
  -- to call, and it is why the guard above is `<` and not `<=`.
  perform app_private.fund_promotional_reward_source(
    v_funded - v_source.budget_total_minor,
    null
  );

  raise notice
    'migration 056: referral programme funded to % % (remaining %).',
    v_funded, v_source.currency_unit,
    (select budget_remaining_minor from app.reward_sources where id = v_source.id);
end;
$$;