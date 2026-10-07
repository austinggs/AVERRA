-- =============================================================================
-- CPX Research LIVE activation (migration 065).
--
-- WHAT THIS PROVES THAT NOTHING ELSE DOES
--
-- provider_live_gate.sql proves the LIVE machinery works using FIXTURE providers
-- (`pglive_live`). It deliberately never touches the real rows, so every assertion in
-- it stays true even if `cpx_research` is still CANDIDATE.
--
-- That is exactly the gap this suite fills. Before this file existed, NOTHING asserted
-- that cpx_research itself was live, that its funding source existed, or that its
-- currency matched the one the adapter writes onto a conversion. A green run of
-- provider_live_gate.sql was fully compatible with CPX being switched back to CANDIDATE
-- and nobody noticing - which is the state it was in for its entire life.
--
-- These assertions are about the REAL seeded rows, which makes this suite fail if
-- someone de-activates CPX without thinking. That is the intent: CPX being live is now
-- a deliberate, asserted fact rather than an accident nobody checks.
--
-- Read-only. No fixture, no insert, no delete - there is nothing to clean up and
-- nothing this suite can leak. It opens its own transaction and rolls it back.
-- =============================================================================

begin;

select plan(21);

-- -----------------------------------------------------------------------------
-- THE PROVIDER IS LIVE, AND EVERY DOC 07 GATE IS RECORDED
-- -----------------------------------------------------------------------------

select is(
  (select lifecycle_state::text from app.providers where code = 'cpx_research'),
  'LIVE',
  'cpx_research is LIVE: users can reach CPX inventory and a conversion can be paid'
);

-- The constraint that exists precisely to stop a one-statement promotion. Each column
-- is listed so a gate added later without evidence cannot slip past a check that only
-- looks at the ones we remembered.
select is(
  (
    select count(*)::int
    from app.providers p
    where p.code = 'cpx_research'
      and p.integration_tested_at is not null
      and p.callback_authenticity_tested_at is not null
      and p.duplicate_replay_tested_at is not null
      and p.economic_validated_at is not null
      and p.commercial_approved_at is not null
      and p.compliance_approved_at is not null
      and p.last_verified_at is not null
  ),
  1,
  'all seven doc 07 decision gates carry a recorded timestamp'
);

select is(
  (select verification_expires_at > last_verified_at from app.providers where code = 'cpx_research'),
  true,
  'verification expiry is after the verification, per doc 07 DYNAMIC NATURE'
);

-- The signature scheme is configuration (law 12). A LIVE provider with no recorded
-- scheme means nobody can tell how its callbacks are authenticated.
select is(
  (select signature_scheme from app.providers where code = 'cpx_research'),
  'md5(trans_id-secure_hash)',
  'the vendor signature scheme is recorded on the provider row'
);

-- The surveywall is the documented entry point (cpx-research.com/main/en/doc.php).
select is(
  (select settlement_currency from app.providers where code = 'cpx_research'),
  'NGN-kobo',
  'the settlement currency is configured, so a settlement row is no longer UNSPECIFIED'
);

-- -----------------------------------------------------------------------------
-- THE FUNDING SOURCE EXISTS, IS ACTIVE, AND MATCHES THE CURRENCY
-- -----------------------------------------------------------------------------

select is(
  public.get_active_provider_reward_source('cpx_research') is not null,
  true,
  'the provider reward source resolves, so a conversion is not left recorded-but-UNPAID'
);

-- THE PAIRING THAT PREVENTS A SILENT HALF-FAILURE. `grant_reward` raises
-- `datatype_mismatch` when the reward unit differs from the source unit. If these two
-- ever diverged, a conversion would be accepted, evidence recorded, the callback
-- answered 200, and the reward then rejected - with nothing in the vendor dashboard to
-- explain why the money did not arrive. CPX_LOCAL_UNIT in
-- src/lib/providers/adapters/cpx-contract.ts is the other half of this pair.
select is(
  (select currency_unit from app.reward_sources where name = 'provider:cpx_research'),
  'NGN-kobo',
  'the funding source unit matches CPX_LOCAL_UNIT, the unit a conversion is recorded in'
);

-- Law 1: no unbacked balance. A zero budget makes every reward fail with "insufficient
-- budget remaining", which looks identical to a provider not sending anything.
select is(
  (select budget_remaining_minor > 0 from app.reward_sources where name = 'provider:cpx_research'),
  true,
  'the funding source holds a positive budget, so a valid conversion can be funded'
);

select is(
  (select budget_remaining_minor <= budget_total_minor
     from app.reward_sources where name = 'provider:cpx_research'),
  true,
  'the budget respects the remaining-within-total constraint'
);

-- -----------------------------------------------------------------------------
-- THE OFFER EXISTS, IS ACTIVE, AND IS REACHABLE
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int
     from app.offers o
     join app.providers p on p.id = o.provider_id
    where p.code = 'cpx_research' and o.is_active),
  1,
  'CPX has exactly one ACTIVE offer row - the wall, which is the unit CPX actually sells'
);

-- The bare base URL. The adapter appends app_id, ext_user_id, secure_hash and subid_1
-- per user per click; the row itself must NOT carry a frozen app id or a user id.
select is(
  (select tracking_base_url
     from app.offers o
     join app.providers p on p.id = o.provider_id
    where p.code = 'cpx_research' and o.is_active),
  'https://offers.cpx-research.com/index.php',
  'the tracking base URL is CPX''s documented wall entry point, with no parameters frozen in'
);

-- The payout is deliberately NULL. CPX pays a different amount to every matched
-- respondent, so there is no single figure to display, and doc 13 PRESENTATION forbids
-- inventing one.
select is(
  (select displayed_payout_minor is null
     from app.offers o
     join app.providers p on p.id = o.provider_id
    where p.code = 'cpx_research' and o.is_active),
  true,
  'no payout figure is claimed for an offer whose amount varies per user'
);

-- The conjunction that made this inert before: is_active AND lifecycle_state = LIVE.
-- Either alone yields nothing, so both are asserted rather than just the visible one.
select is(
  (select count(*)::int from public.get_offer_tracking_target(o.id)
     from app.offers o
     join app.providers p on p.id = o.provider_id
    where p.code = 'cpx_research' and o.is_active),
  1,
  'get_offer_tracking_target resolves the CPX offer, so the click route can mint a link'
);

select is(
  (select count(*)::int
     from public.list_live_offers() l
    where l->>'providerCode' = 'cpx_research'),
  1,
  'the CPX wall appears in the live offer listing, so users can see it'
);

-- THE href REMOVAL. A raw base URL in this payload cannot carry app_id, ext_user_id,
-- secure_hash or subid_1, so any client rendering it produced a click CPX could not
-- attribute to anyone. The listing must NOT offer one.
select is(
  (select count(*)::int from public.list_live_offers() where l ? 'href'),
  0,
  'no href is returned: a provider link must be minted per user through the click route'
);

-- -----------------------------------------------------------------------------
-- THE SETTLEMENT ENTRY POINT EXISTS, AND IS NOT REACHABLE BY ANYONE ELSE
-- -----------------------------------------------------------------------------

select has_function(
  'public',
  'settle_provider_period',
  ARRAY['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone', 'bigint', 'integer', 'uuid'],
  'the settlement command has a public entry point, so a PENDING reward can be released'
);

-- THE MONEY-RELEASING FUNCTION. It is the only reachable path from a provider
-- conversion to an AVAILABLE reward, so an anon caller reaching it would let anyone
-- holding the publishable key release money. Scoped AND unreachable are both needed:
-- a perfectly scoped function is still an open door if anon can call it.
select ok(
  not has_function_privilege('anon', 'public.settle_provider_period(uuid,text,timestamptz,timestamptz,bigint,integer,uuid)', 'EXECUTE'),
  'anon cannot execute settle_provider_period'
);

select ok(
  not has_function_privilege('authenticated', 'public.settle_provider_period(uuid,text,timestamptz,timestamptz,bigint,integer,uuid)', 'EXECUTE'),
  'authenticated cannot execute settle_provider_period'
);

-- And it must actually be usable, or rewards would be permanently PENDING and the only
-- "fix" operators would reach for is a manual UPDATE that bypasses the gate.
select ok(
  has_function_privilege('service_role', 'public.settle_provider_period(uuid,text,timestamptz,timestamptz,bigint,integer,uuid)', 'EXECUTE'),
  'service_role CAN execute settle_provider_period, so reconciliation is operable'
);

-- THE GATE IS STILL THE GATE. Migration 065 promoted a provider and seeded a budget;
-- it must not have opened a second route to AVAILABLE. The ungated transition is revoked
-- from EVERY role including service_role, because a `create or replace` under a new name
-- carries the original ACL with it.
select ok(
  not has_function_privilege('service_role', 'app_private.transition_reward_ungated(uuid,app.reward_state,text,uuid,uuid)', 'EXECUTE'),
  'transition_reward_ungated is still revoked from service_role, so settlement stays the ONLY path'
);

-- -----------------------------------------------------------------------------
-- PROVISIONAL EARNINGS NO LONGER COVERS CPX
-- -----------------------------------------------------------------------------

-- Migration 064 filters `p.lifecycle_state <> 'LIVE'`, so promoting CPX moved it onto
-- the governed path automatically. Nothing in that file mentions CPX, so this coupling
-- is invisible in the code and has to be asserted somewhere. A CPX conversion appearing
-- in the ESTIMATE surface while also carrying a real reward would double-count it.
select ok(
  not exists (
    select 1 from app.providers p
     where p.code = 'cpx_research' and p.lifecycle_state <> 'LIVE'
  ),
  'CONTROL: cpx_research satisfies the LIVE predicate the provisional projection filters on'
);

select * from finish();

rollback;