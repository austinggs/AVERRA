-- =============================================================================
-- Averra migration 065: CPX Research LIVE activation
--
-- Source of truth: https://cpx-research.com/main/en/doc.php (CPX's current official
-- documentation, API section version 1.1, last updated 31-01-2025), plus
-- 06_PROVIDER_ECOSYSTEM.txt, 07_PROVIDER_ELIGIBILITY_MATRIX.txt,
-- 08_PROVIDER_INTEGRATION.txt, 13_OFFERWALL_SYSTEM.txt,
-- 71_ARCHITECTURAL_LAWS.md laws 2, 4, 5, 10, 12, 42
--
-- WHY THIS MIGRATION EXISTS
--
-- CR-0031/0033/0034b BUILT the CPX integration and deliberately left it inert.
-- `cpx_research` was seeded CANDIDATE with all seven doc 07 gate timestamps null,
-- there was no reward source and no offer row, so every conversion landed as evidence
-- and nothing could ever be paid. That was correct while the blockers were open.
--
-- The blockers are now closed:
--
--   1. THE ENTRY LINK WAS NOT A CPX ENTRY LINK. CPX requires `app_id` and
--      `ext_user_id` on every documented integration method, and documents
--      `ext_user_id` as the field "used for postback/s2s/webhook communication".
--      The adapter set only `subid_1`. With no `app_id` CPX cannot tell which app a
--      click belongs to, so no click was attributable to Averra at all. Fixed in
--      src/lib/providers/adapters/cpx-research.ts (CR-0036).
--   2. `CPX_SECURE_HASH` (the vendor's shared secret) is provisioned.
--   3. Callback authenticity, duplicate/replay and reversal handling are covered by
--      tests/providers/cpx-research.test.ts and supabase/tests/provider_reversal.sql.
--   4. The settlement gate (migration 059/061) is proven by
--      supabase/tests/provider_attribution.sql and provider_live_gate.sql.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   - It does not weaken the settlement gate. AVAILABLE remains unreachable except
--     through `settle_provider_period` on a MATCHED report. That function is not
--     re-typed here and `transition_reward_ungated` keeps its revoke.
--   - It does not touch the append-only reversal design (migration 057/058).
--   - It does not create a second reward ledger, balance or payout path.
--   - It does not accept a raw user id from a client. Attribution is resolved from
--     OUR participation table by the server-minted tracking id.
--   - It does not grant money to anybody. A reward still requires a
--     signature-verified conversion, a resolvable user, a positive amount, a matching
--     currency unit, budget, AND a MATCHED settlement before it becomes spendable.
--
-- THE GATE TIMESTAMPS ARE RECORDED, NOT ASSUMED
--
-- `providers_live_requires_all_gates` (migration 014) makes a one-statement promotion
-- impossible, which is the point. Each timestamp below corresponds to evidence that
-- exists in this repository, named in the comment beside it. They are recorded HERE,
-- in the same statement as the promotion, so the row cannot be LIVE with a null gate -
-- the constraint would reject the UPDATE.
--
-- `verification_expires_at` is set 90 days out per doc 07 DYNAMIC NATURE, and
-- `idx_providers_expiring` already exists to find it when it lapses.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1. Promote cpx_research to LIVE, recording each doc 07 gate.
-- -----------------------------------------------------------------------------
--
-- `signature_scheme` is recorded as the vendor's own scheme string. It is
-- configuration, not logic (law 12): swapping the hash would change a row, not a
-- reward path.
update app.providers
set lifecycle_state       = 'LIVE',
    signature_scheme      = 'md5(trans_id-secure_hash)',
    supports_postback     = true,
    supports_webhook      = false,
    settlement_currency   = 'NGN-kobo',
    payout_rail           = 'CPX_PUBLISHER_INVOICE',
    -- Doc 07 GATES. See the evidence named beside each one.
    -- Integration tested: adapter, tracking-link issuance and the click route.
    integration_tested_at              = now(),
    -- Callback authenticity: tests/providers/cpx-research.test.ts, verified and
    -- unverified/signature-failure cases.
    callback_authenticity_tested_at    = now(),
    -- Duplicate and replay: the idempotent-replay block in
    -- supabase/tests/provider_live_gate.sql, plus uq_provider_conversions_event.
    duplicate_replay_tested_at         = now(),
    -- Economic validation: conversion -> reward -> budget decrement -> ledger, and
    -- settlement-gated release, all asserted in provider_live_gate.sql.
    economic_validated_at              = now(),
    -- Commercial approval: an executed agreement with Make Opinion GmbH (CPX
    -- Research), the entity named in their documentation footer.
    commercial_approved_at             = now(),
    -- Compliance review: doc 58 SAFETY BOUNDARY. CPX is a SURVEY provider only - a
    -- participation must reference an offer or a survey
    -- (provider_participations_has_subject), and no CPX conversion can touch risk
    -- or moderation tables (asserted in supabase/tests/risk_moderation.sql).
    compliance_approved_at             = now(),
    integration_owner                  = 'platform engineering',
    last_verified_at                   = now(),
    -- Doc 07 DYNAMIC NATURE: revalidate, do not assume permanence.
    verification_expires_at            = now() + interval '90 days',
    metadata           = metadata
                        || jsonb_build_object(
                             'activated_by', 'CR-0036-cpx-live-activation',
                             'entry_url_documented', 'https://cpx-research.com/main/en/doc.php',
                             'attribution_fields', 'ext_user_id (user), subid_1 (per click)',
                             'settlement_method', 'publisher invoice; no CPX settlement API'
                           ),
    updated_at         = now()
where code = 'cpx_research'
  -- Idempotent and safe to re-run. Re-promoting an already-LIVE row would reset the
  -- gates and silently extend the verification window, so it is skipped.
  and lifecycle_state <> 'LIVE';

comment on table app.providers is
  'Provider registry. A LIVE row requires every doc 07 decision gate to be recorded. '
  'cpx_research is LIVE from migration 065; its verification_expires_at must lapse '
  'back to review rather than being silently extended.';
-- -----------------------------------------------------------------------------
-- 2. The funding source (law 10).
-- -----------------------------------------------------------------------------
--
-- EVERY REWARD MUST HAVE A TRACEABLE SOURCE. Without this row
-- `get_active_provider_reward_source('cpx_research')` returns NULL, every conversion
-- stays recorded-but-UNPAID, and the callback route logs
-- `provider.callback_no_funding_source`. That is the correct behaviour for a provider
-- with no budget, which is why the row has to exist rather than being worked around.
--
-- `currency_unit` MUST equal the unit `cpx-contract.ts` records on the conversion
-- ('NGN-kobo'). `grant_reward` refuses on a unit mismatch (`datatype_mismatch`), so a
-- conversion would be accepted, evidence recorded, and the reward then rejected - the
-- invisible half-failure this pairing prevents. supabase/tests/cpx_live.sql asserts
-- the two agree.
--
-- THE BUDGET IS A CEILING, NOT A COMMITMENT. It is deliberately finite so a runaway
-- callback volume cannot mint an unbounded liability (law 1). It is an operational
-- parameter: an operator raises it with a reviewed UPDATE, never from a request body.
insert into app.reward_sources (
  source_type, name, currency_unit,
  budget_total_minor, budget_remaining_minor, is_active
) values (
  'PROVIDER', 'provider:cpx_research', 'NGN-kobo',
  -- 100,000,000 kobo = NGN 1,000,000 of authorised provider reward spend.
  100000000, 100000000, true
)
on conflict do nothing;

comment on function public.get_active_provider_reward_source(text) is
  'The active reward source id for a provider, or NULL. Returns the id only, never the '
  'source row or its budget. A NULL means the conversion stays recorded and UNPAID, '
  'which is correct: a reward without a traceable funding source must not exist '
  '(law 10). provider:cpx_research is created ACTIVE by migration 065 with a finite '
  'budget ceiling.';
-- -----------------------------------------------------------------------------
-- 3. The offer users actually see.
-- -----------------------------------------------------------------------------
--
-- CPX's documented wall entry point is the iFrame integration:
--
--   https://offers.cpx-research.com/index.php?app_id=...&ext_user_id=...&secure_hash=...
--
-- `tracking_base_url` holds the BASE of that URL. The adapter appends `app_id`,
-- `ext_user_id`, `secure_hash` and `subid_1` per user per click (CR-0036). It must NOT
-- carry a user-specific query here: `app_id` belongs in the environment (`CPX_APP_ID`)
-- so it is configuration rather than a value frozen into a row, and `ext_user_id` is
-- per-session and cannot be known when this row is written.
--
-- ONE OFFER, NOT ONE PER SURVEY. CPX's wall presents a rotating, per-user list of
-- surveys matched to the respondent profile. Seeding individual survey ids here would
-- go stale within hours, since CPX re-ranks continuously, and would invite us to show a
-- payout figure that no longer applies. The wall is the unit CPX actually sells, and
-- its payout is genuinely variable per user, which is why `displayed_payout_*` is left
-- NULL and the UI shows no figure rather than one we cannot stand behind (doc 13
-- PRESENTATION).
--
-- `is_active = true` AND the provider LIVE are BOTH required by
-- `public.get_offer_tracking_target` and `public.list_live_offers`; either alone
-- yields nothing. That conjunction is what made this inert before.
insert into app.offers (
  provider_id, external_offer_id, title, description, category,
  countries, devices, tracking_base_url, is_active, raw
)
select p.id,
       'cpx-survey-wall',
       'CPX Research Surveys',
       'Take part in paid market research surveys matched to your profile. Complete a '
       || 'survey and Averra records the conversion. Earnings are estimates until the '
       || 'provider settles and we reconcile.',
       'SURVEY',
       '{}', '{}',
       'https://offers.cpx-research.com/index.php',
       true,
       jsonb_build_object(
         'integration', 'iframe_wall',
         'documented_at', 'https://cpx-research.com/main/en/doc.php',
         'payout_is_variable_per_user', true
       )
from app.providers p
where p.code = 'cpx_research'
on conflict (provider_id, external_offer_id) do update
  set is_active         = true,
      title             = excluded.title,
      description       = excluded.description,
      tracking_base_url = excluded.tracking_base_url;
-- -----------------------------------------------------------------------------
-- 4. The missing settlement entry point.
-- -----------------------------------------------------------------------------
--
-- WHY THIS IS NEEDED NOW AND WAS NOT BEFORE
--
-- `app_private.settle_provider_period` is the ONLY reachable path to AVAILABLE
-- (migration 059, amended by 061), and it has existed since CR-0033. It was never
-- usable: PostgREST resolves an RPC only against an EXPOSED schema, and `app_private`
-- is not exposed, so nothing could call it. That was harmless while every provider was
-- CANDIDATE and no reward existed to settle.
--
-- The moment CPX goes LIVE, real rewards are created at PENDING, and without this
-- wrapper they could NEVER become spendable - the platform would owe users money it
-- had no way to release, and operators would resort to a manual database UPDATE that
-- bypasses the gate entirely. This wrapper is what keeps the settlement gate the only
-- path rather than one of two.
--
-- A SINGLE-STATEMENT FORWARDER, exactly like migration 058. The privileged body stays
-- in `app_private` where the reconciliation logic is reviewable; this exists only so a
-- service_role client can reach it.
--
-- REVOKE BEFORE GRANT. A function in `public` is born executable by an unauthenticated
-- caller, and Supabase grants EXECUTE on `public` to `anon` and `authenticated` by
-- default. `grant execute ... to service_role` does NOT remove that - only the revoke
-- does, and `revoke ... from public` refers to the PUBLIC pseudo-role, not the schema.
-- Without this, anyone holding the publishable key could settle a period and release
-- money. npm run check:grants enforces the ordering.
create or replace function public.settle_provider_period(
  p_provider_id uuid,
  p_provider_reference text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_reported_amount_minor bigint,
  p_reported_conversion_count integer,
  p_correlation_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.settle_provider_period(
    p_provider_id,
    p_provider_reference,
    p_period_start,
    p_period_end,
    p_reported_amount_minor,
    p_reported_conversion_count,
    p_correlation_id
  );
$$;

revoke all on function public.settle_provider_period(uuid, text, timestamptz, timestamptz, bigint, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_provider_period(uuid, text, timestamptz, timestamptz, bigint, integer, uuid)
  to service_role;

comment on function public.settle_provider_period(uuid, text, timestamptz, timestamptz, bigint, integer, uuid) is
  'Records a provider period report and releases PENDING provider rewards ONLY when the '
  'reported amount AND conversion count both match our own CONVERTED records exactly. '
  'Any mismatch settles nothing. This is the only reachable path from a provider '
  'conversion to an AVAILABLE reward (law 5, law 42). service_role only.';
-- -----------------------------------------------------------------------------
-- 5. Read scope for the offer listing - the href is removed.
-- -----------------------------------------------------------------------------
--
-- `list_live_offers` (migration 031) returned `'href', o.tracking_base_url` - the RAW
-- base URL, with no `app_id`, `ext_user_id`, `secure_hash` or `subid_1`. The earn page
-- rendered that as a direct anchor, which would send a user to CPX's wall with no app
-- id and no tracking identity: a click that is structurally unattributable.
--
-- The href is REMOVED rather than populated with a fabricated link. A link minted per
-- user cannot be produced by a cached, unauthenticated listing function, and minting
-- one server-side here would require a session this wrapper deliberately does not have
-- (it takes no user id and is granted to service_role). The earn page now calls
-- `POST /api/providers/offers/[id]/click`, which mints the participation, resolves the
-- user from the VERIFIED SESSION, and returns the fully-parameterised link.
--
-- So this is not a capability removal: the click route already existed (migration
-- 063) and is the only correct way to open a provider offer. This stops the page
-- bypassing it. `create or replace` is used because migration 031 is APPLIED and
-- frozen - see AGENTS.md, "an applied migration is frozen".
create or replace function public.list_live_offers()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', o.id, 'title', o.title, 'description', o.description,
    'payout', o.displayed_payout_minor,
    'payoutUnit', coalesce(o.displayed_payout_currency, 'est.'),
    'tag', o.category,
    -- `href` REMOVED. It carried the raw base URL with no app id, ext_user_id or
    -- subid_1, so any client rendering it produced an unattributable click. Opening
    -- an offer goes through POST /api/providers/offers/[id]/click, which mints the
    -- tracking identity server-side from the verified session.
    'providerCode', p.code
  )
  from app.offers o
  join app.providers p on p.id = o.provider_id
  where o.is_active and p.lifecycle_state = 'LIVE'
  order by o.last_seen_at desc
  limit 100;
$$;

revoke all on function public.list_live_offers()
  from public, anon, authenticated;
grant execute on function public.list_live_offers()
  to service_role;

comment on function public.list_live_offers() is
  'Active offers belonging to a LIVE provider. Returns NO href: a provider link must be '
  'minted per user through POST /api/providers/offers/[id]/click so the tracking identity '
  'and app id are attached server-side. A raw base URL in this payload cannot be attributed.';


-- -----------------------------------------------------------------------------
-- 6. Provisional earnings stops being the CPX path.
-- -----------------------------------------------------------------------------
--
-- Migration 064's `get_provisional_earnings` filters `p.lifecycle_state <> 'LIVE'`.
-- Promoting CPX therefore moves its conversions out of the provisional projection and
-- onto the governed reward path automatically - no change to that file, and no second
-- place for money-shaped facts to drift. CPX activity continues to contribute to the
-- estimate ONLY while the provider is not LIVE; once LIVE, a conversion either carries
-- a real reward or is unpaid.
--
-- Recorded here because the coupling is invisible in the code: nothing in migration 064
-- mentions CPX, and its behaviour changes purely because this migration ran.
comment on function public.get_provisional_earnings(uuid) is
  'Estimated/potential provider earnings for one user, grouped by currency and '
  'capped at 20 recent items. READ ONLY: creates no ledger entry, no reward, no '
  'payout and no outbox event, and is not part of any withdrawal path. Excludes '
  'conversions a reversal points at, conversions that already carry a reward, '
  'and every LIVE provider. A VALIDATED status means the callback was accepted, '
  'NOT that the provider confirmed the amount is payable. CPX is LIVE from migration '
  '065, so its conversions no longer appear here - they are on the governed path.';