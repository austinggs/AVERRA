-- =============================================================================
-- CPX CANDIDATE->LIVE AUDIT: THE LISTING GATE AND THE REWARD-FUNDING PATH.
--
-- WHY THIS SUITE EXISTS
--
-- The audit asked: "if cpx_research is promoted to LIVE tomorrow, what happens?"
-- Two of the paths that answer that question had NO behavioural coverage:
--
-- 1. THE LISTING GATE. `public.list_live_offers()` and `public.list_live_surveys()`
--    are the earn-page surfaces. Each filters `is_active AND lifecycle_state =
--    'LIVE'`, so a CANDIDATE provider's inventory must be invisible while the same
--    inventory on a LIVE provider must surface - and an inactive row must stay
--    hidden even from a LIVE provider. Grants-only coverage would not notice a
--    filter that silently stopped filtering.
--
-- 2. THE REWARD-FUNDING PATH. `public.apply_conversion_reward` is THE bridge from
--    a provider event to money (migration 015: "the ONLY place a provider event
--    becomes money"). It previously had grants-only coverage: no test ever
--    exercised its five refusal cases or its happy path, so the exact behaviour
--    CPX going LIVE would switch on - VALIDATED status, LIVE provider, resolved
--    user, positive amount, currency, named funding source, then grant_reward ->
--    ledger -> budget decrement - was asserted nowhere. Its companion lookup,
--    `public.get_active_provider_reward_source`, returned an id no test checked.
--
-- Everything below runs against FIXTURE rows only: `pglive_` provider codes,
-- `pglive-%` external ids and provider event ids, and one fixture auth user. The
-- deployed `cpx_research` row is never touched, never promoted, never paid.
--
-- Suite mechanics (AGENTS.md): `begin;` precedes `plan()`, the suite deletes its
-- own prefix before creating anything, and `rollback;` is the final statement.
-- The runner does NOT wrap a suite in a transaction.
-- =============================================================================

begin;

select plan(34);

-- Defensive cleanup. An ABORTED suite commits its fixture (the runner's rollback
-- cannot undo an aborted transaction), so a re-run must not collide with the
-- previous run's rows. Order is FK order: conversions -> rewards -> inventory ->
-- providers -> sources -> the auth user.
--
-- On a clean database every statement below matches zero rows. The `rewards`
-- delete is the one caveat: a leaked reward created through grant_reward carries
-- reward_state_transitions rows, and that table's append-only trigger blocks the
-- cascade - so if it ever matches more than zero rows it fails loudly rather than
-- silently skipping, which is the correct outcome (see AGENTS.md "An append-only
-- table blocks its own cascade").
delete from app.provider_conversions where provider_event_id like 'pglive-%';
delete from app.rewards where source_event_id like 'pglive-%';
delete from app.offers where external_offer_id like 'pglive-%';
delete from app.surveys where external_survey_id like 'pglive-%';
delete from app.providers where code like 'pglive_%';
delete from app.reward_sources
where name in ('provider:pglive_live', 'provider:pglive_cand');
delete from auth.users where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

-- =============================================================================
-- FIXTURES
-- =============================================================================

-- The resolved user for every conversion below. `rewards.user_id` and
-- `provider_conversions.user_id` both reference auth.users, so a random uuid in
-- the insert would fail with 23503 before reaching any rule under test.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'authenticated', 'authenticated', 'pglive_gate@example.invalid', 'x',
  now(), now(), now()
);

-- Two providers. Both start CANDIDATE because `providers_live_requires_all_gates`
-- makes a one-statement promotion impossible; only `pglive_live` is then promoted
-- with every doc 07 gate recorded. The candidate row keeps all gates null, which
-- is exactly the state `cpx_research` is in today.
insert into app.providers (code, display_name, provider_class, lifecycle_state)
values
  ('pglive_cand', 'pgTAP listing candidate provider', 'SURVEY', 'CANDIDATE'),
  ('pglive_live', 'pgTAP listing live provider', 'SURVEY', 'CANDIDATE');

update app.providers
set lifecycle_state = 'LIVE',
    settlement_currency = 'NGN-kobo',
    integration_tested_at = now(),
    callback_authenticity_tested_at = now(),
    duplicate_replay_tested_at = now(),
    economic_validated_at = now(),
    commercial_approved_at = now(),
    compliance_approved_at = now(),
    last_verified_at = now(),
    verification_expires_at = now() + interval '90 days'
where code = 'pglive_live';

-- Three offers: active-on-candidate (must hide), active-on-live (must show),
-- inactive-on-live (must hide). The inactive row proves the second half of the
-- filter - `is_active` - still bites for a LIVE provider.
insert into app.offers (provider_id, external_offer_id, title, is_active)
select p.id, v.external_id, v.title, v.active
from (values
  ('pglive_cand', 'pglive-off-cand', 'pgTAP candidate offer', true),
  ('pglive_live', 'pglive-off-live', 'pgTAP live offer', true),
  ('pglive_live', 'pglive-off-off',  'pgTAP inactive offer', false)
) as v(code, external_id, title, active)
join app.providers p on p.code = v.code;

-- The same triple for surveys, because `list_live_surveys` is a SEPARATE wrapper
-- with its own WHERE clause over a table that does not share `offers`' column
-- names (migration 031 keeps them separate rather than faking a shared
-- projection). A green offer test says nothing about the survey wrapper.
insert into app.surveys (
  provider_id, external_survey_id, title, is_active,
  base_reward_minor, reward_currency, estimated_duration_seconds, categories
)
select p.id, v.external_id, v.title, v.active, 750, 'NGN-kobo', 300, array['Gaming']
from (values
  ('pglive_cand', 'pglive-sv-cand', 'pgTAP candidate survey', true),
  ('pglive_live', 'pglive-sv-live', 'pgTAP live survey', true),
  ('pglive_live', 'pglive-sv-off',  'pgTAP inactive survey', false)
) as v(code, external_id, title, active)
join app.providers p on p.code = v.code;

-- The conventional funding-source names `get_active_provider_reward_source`
-- resolves (`'provider:' || code`). The live one is active with a real budget;
-- the candidate one is deliberately INACTIVE so "inactive is not returned" can be
-- distinguished from "the row does not exist".
insert into app.reward_sources (
  source_type, name, currency_unit, budget_total_minor, budget_remaining_minor, is_active
) values
  ('PROVIDER', 'provider:pglive_live', 'NGN-kobo', 1000000, 1000000, true),
  ('PROVIDER', 'provider:pglive_cand', 'NGN-kobo', 1000000, 1000000, false);

-- Five conversions, each violating EXACTLY ONE precondition of
-- apply_conversion_reward, in the order the function checks them (status before
-- provider before user before amount before currency before source). If two
-- fixtures broke two rules at once, PostgreSQL would report whichever it
-- evaluates first rather than the rule the test is written for.
insert into app.provider_conversions (
  provider_id, provider_event_id, source_type, user_id, event_type,
  status, gross_value_minor, currency
)
select p.id, v.event_id, 'OFFER', v.uid, 'cpx:complete',
       v.status::app.conversion_status, v.gross, v.currency
from (values
  -- VALIDATED but the provider is CANDIDATE: fails the LIVE gate.
  ('pglive_cand', 'pglive-conv-cand',
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'VALIDATED'::app.conversion_status,
   5000::bigint, 'NGN-kobo'),
  -- LIVE provider but not VALIDATED: fails the status gate first.
  ('pglive_live', 'pglive-conv-recv',
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'RECEIVED'::app.conversion_status,
   5000::bigint, 'NGN-kobo'),
  -- VALIDATED, LIVE, but no resolved user: would create money nobody can withdraw.
  ('pglive_live', 'pglive-conv-nouser',
   null::uuid, 'VALIDATED'::app.conversion_status, 5000::bigint, 'NGN-kobo'),
  -- VALIDATED, LIVE, resolved user: refuses only for the NULL source argument.
  ('pglive_live', 'pglive-conv-nosrc',
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'VALIDATED'::app.conversion_status,
   5000::bigint, 'NGN-kobo'),
  -- The happy path: every precondition satisfied.
  ('pglive_live', 'pglive-conv-ok',
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'VALIDATED'::app.conversion_status,
   5000::bigint, 'NGN-kobo')
) as v(code, event_id, uid, status, gross, currency)
join app.providers p on p.code = v.code;

-- =============================================================================
-- FIXTURE CONTROLS
--
-- A "hidden" assertion that passes because the fixture row was never created is
-- the `0 bad` failure mode. Every population is counted beside its gate test.
-- =============================================================================

select is(
  (select count(*)::int from app.offers where external_offer_id like 'pglive-%'),
  3,
  'CONTROL: three fixture offers exist (candidate-active, live-active, live-inactive)'
);

select is(
  (select count(*)::int from app.surveys where external_survey_id like 'pglive-%'),
  3,
  'CONTROL: three fixture surveys exist, so the survey gate is reachable'
);

select is(
  (select count(*)::int from app.reward_sources
    where name in ('provider:pglive_live', 'provider:pglive_cand')),
  2,
  'CONTROL: both fixture funding sources exist, active and inactive'
);

select is(
  (select lifecycle_state::text from app.providers where code = 'pglive_live'),
  'LIVE',
  'CONTROL: the fixture provider really is LIVE, with every doc 07 gate recorded'
);

select is(
  (select lifecycle_state::text from app.providers where code = 'pglive_cand'),
  'CANDIDATE',
  'CONTROL: the fixture provider really is CANDIDATE, gates null as cpx_research is'
);

-- =============================================================================
-- THE LISTING GATE (earn-page surfaces)
--
-- Non-vacuity: the two `true` answers below prove the wrapper returns fixture
-- rows of the right shape, so the `false` answers are the filter speaking, not
-- an empty result set.
-- =============================================================================

select is(
  (
    select exists (
      select 1 from public.list_live_offers() o
      where (o->>'id')::uuid =
        (select id from app.offers where external_offer_id = 'pglive-off-live')
    )
  ),
  true,
  'an ACTIVE offer from a LIVE provider IS listed on the earn surface'
);

select is(
  (
    select exists (
      select 1 from public.list_live_offers() o
      where (o->>'id')::uuid =
        (select id from app.offers where external_offer_id = 'pglive-off-cand')
    )
  ),
  false,
  'an ACTIVE offer from a CANDIDATE provider is NOT listed (the listing gate)'
);

select is(
  (
    select exists (
      select 1 from public.list_live_offers() o
      where (o->>'id')::uuid =
        (select id from app.offers where external_offer_id = 'pglive-off-off')
    )
  ),
  false,
  'an INACTIVE offer stays hidden even from a LIVE provider'
);

select is(
  (
    select exists (
      select 1 from public.list_live_surveys() o
      where (o->>'id')::uuid =
        (select id from app.surveys where external_survey_id = 'pglive-sv-live')
    )
  ),
  true,
  'an ACTIVE survey from a LIVE provider IS listed on the earn surface'
);

select is(
  (
    select exists (
      select 1 from public.list_live_surveys() o
      where (o->>'id')::uuid =
        (select id from app.surveys where external_survey_id = 'pglive-sv-cand')
    )
  ),
  false,
  'an ACTIVE survey from a CANDIDATE provider is NOT listed (the listing gate)'
);

select is(
  (
    select exists (
      select 1 from public.list_live_surveys() o
      where (o->>'id')::uuid =
        (select id from app.surveys where external_survey_id = 'pglive-sv-off')
    )
  ),
  false,
  'an INACTIVE survey stays hidden even from a LIVE provider'
);

-- =============================================================================
-- THE WRAPPERS ARE service_role-ONLY
--
-- Population is enumerated first, then filtered: the count below is 3 functions
-- x 2 unauthenticated-capable roles = 6, reported beside the bad count so a
-- signature typo (which resolves to nothing) cannot read as an assurance. The
-- service_role control proves the same signatures resolve at all.
-- =============================================================================

select is(
  (
    select count(*)
    from (values
            ('public.list_live_offers()'),
            ('public.list_live_surveys()'),
            ('public.get_active_provider_reward_source(text)')
          ) as f(sig)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_function_privilege(r.rolname, f.sig::regprocedure, 'EXECUTE')
  ),
  0::bigint,
  'TOTAL 6 checked (3 wrappers x anon + authenticated), 0 can execute'
);

select is(
  (
    select count(*)
    from (values
            ('public.list_live_offers()'),
            ('public.list_live_surveys()'),
            ('public.get_active_provider_reward_source(text)')
          ) as f(sig)
    cross join pg_roles r
    where r.rolname = 'service_role'
      and has_function_privilege(r.rolname, f.sig::regprocedure, 'EXECUTE')
  ),
  3::bigint,
  'CONTROL: service_role can execute all 3, so the zero above is not vacuous'
);

-- =============================================================================
-- THE FUNDING-SOURCE LOOKUP (law 10)
--
-- Returns ONLY the id: a source row carries a budget balance and the caller has
-- no business reading it. NULL means the conversion stays recorded and UNPAID.
-- =============================================================================

select is(
  public.get_active_provider_reward_source('pglive_live'),
  (select id from app.reward_sources where name = 'provider:pglive_live'),
  'the ACTIVE provider source id is returned, by the conventional name'
);

select is(
  (select is_active from app.reward_sources where name = 'provider:pglive_cand'),
  false,
  'CONTROL: the candidate source exists and is inactive, so NULL below is the filter'
);

select is(
  public.get_active_provider_reward_source('pglive_cand'),
  null::uuid,
  'an INACTIVE source is not returned: a deactivated budget funds nothing'
);

select is(
  public.get_active_provider_reward_source('pglive_nope'),
  null::uuid,
  'an unknown provider code returns NULL, so the conversion stays recorded and UNPAID'
);

-- =============================================================================
-- apply_conversion_reward: THE FIVE REFUSALS
--
-- Exact SQLERRM equality, per pgTAP: the full sentence, not the constraint name.
-- Each fixture violates exactly one precondition, so the message identifies WHICH
-- rule fired rather than whichever PostgreSQL evaluates first.
-- =============================================================================

select throws_ok(
  $$
    select public.apply_conversion_reward('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
  $$,
  '23503',
  'apply_conversion_reward: unknown conversion eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'an unknown conversion id is refused: no event, no reward (law 5)'
);

select throws_ok(
  $$
    select public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-recv')
    )
  $$,
  '23514',
  'apply_conversion_reward: conversion status is RECEIVED, expected VALIDATED',
  'only a VALIDATED conversion may become money; RECEIVED is not paid'
);

select throws_ok(
  $$
    select public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-cand')
    )
  $$,
  '23514',
  'apply_conversion_reward: provider is CANDIDATE, not LIVE',
  'a CANDIDATE provider pays nothing - the gate CPX must pass before any conversion converts'
);

select throws_ok(
  $$
    select public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-nouser')
    )
  $$,
  '23514',
  'apply_conversion_reward: conversion has no resolved user',
  'an unattributed conversion is refused, never credited to nobody'
);

select throws_ok(
  $$
    select public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-nosrc')
    )
  $$,
  '22004',
  'apply_conversion_reward: a funding source is required (law 10)',
  'a NULL funding source is refused: every reward has a traceable funding source'
);

-- =============================================================================
-- THE HAPPY PATH - exactly what CPX going LIVE would activate
-- =============================================================================

-- Baseline captured immediately before the grant, so the ledger assertions below
-- count only this transaction's writes.
create temporary table pglive_ledger_before as
select count(*)::bigint as n from app.ledger_entries;

select is(
  (select budget_remaining_minor from app.reward_sources
    where name = 'provider:pglive_live'),
  1000000::bigint,
  'CONTROL: the provider budget is untouched before the happy path'
);

select is(
  (
    select r.amount_minor
    from public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-ok'),
      (select id from app.reward_sources where name = 'provider:pglive_live')
    ) as r
  ),
  5000::bigint,
  'a VALIDATED conversion on a LIVE provider grants the reward through the public entry point'
);

select is(
  (select status::text from app.provider_conversions
    where provider_event_id = 'pglive-conv-ok'),
  'CONVERTED',
  'the conversion is marked CONVERTED only after the grant succeeded'
);

select is(
  (select reward_id is not null from app.provider_conversions
    where provider_event_id = 'pglive-conv-ok'),
  true,
  'the conversion is linked to its reward, so the pair can be audited together'
);

select is(
  (select state::text from app.rewards
    where source_event_id = 'pglive-conv-ok'
      and event_type = 'PROVIDER_CONVERSION'),
  'PENDING',
  'the reward settles at PENDING, never AVAILABLE: settlement is a separate gate (CR-0033)'
);

select is(
  (select budget_remaining_minor from app.reward_sources
    where name = 'provider:pglive_live'),
  995000::bigint,
  'the funding budget was decremented by exactly the reward amount'
);

select is(
  (select count(*) from app.ledger_entries),
  (select n from pglive_ledger_before) + 1,
  'exactly ONE immutable ledger entry was posted for the credit (law 2)'
);

select is(
  (
    select count(*) from app.outbox_events
    where event_type = 'provider.conversion_rewarded'
      and aggregate_id = (select id::text from app.provider_conversions
                           where provider_event_id = 'pglive-conv-ok')
  ),
  1::bigint,
  'the outbox event exists, written in the SAME transaction as the state change'
);

select is(
  (
    select count(*) from app.audit_events
    where action = 'provider.conversion_rewarded'
      and target_id = (select id::text from app.provider_conversions
                        where provider_event_id = 'pglive-conv-ok')
  ),
  1::bigint,
  'the audit event records who was credited and in what state'
);

-- =============================================================================
-- IDEMPOTENT REPLAY (law 5) - a retried webhook must not pay twice
-- =============================================================================

select is(
  (
    select r.id
    from public.apply_conversion_reward(
      (select id from app.provider_conversions where provider_event_id = 'pglive-conv-ok'),
      (select id from app.reward_sources where name = 'provider:pglive_live')
    ) as r
  ),
  (select id from app.rewards
    where source_event_id = 'pglive-conv-ok' and event_type = 'PROVIDER_CONVERSION'),
  'a replay returns the EXISTING reward rather than granting a second one'
);

select is(
  (select budget_remaining_minor from app.reward_sources
    where name = 'provider:pglive_live'),
  995000::bigint,
  'a replay spends no additional budget'
);

select is(
  (select count(*) from app.ledger_entries),
  (select n from pglive_ledger_before) + 1,
  'a replay posts no additional ledger entry'
);

select * from finish();

rollback;



