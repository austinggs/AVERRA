-- =============================================================================
-- Averra migration 063: Tracking-link issuance entry points
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt ADAPTER INTERFACE (createTrackingLink),
-- 13_OFFERWALL_SYSTEM.txt, doc 13 TRACKING, 71_ARCHITECTURAL_LAWS.md laws 4/12/25
--
-- WHY THIS EXISTS
--
-- Migration 060 can mint a participation, but nothing can REACH it. Two gaps, both
-- closed here:
--
--   1. `app_private.begin_provider_participation` is unreachable, because PostgREST
--      can only resolve an RPC against an EXPOSED schema and `app_private` is not
--      exposed. Same reason migration 058 exists for CR-0032's reversal commands.
--
--   2. Nothing could read which URL to send the user to. `offers.tracking_base_url`
--      holds the provider's destination, and reading it directly is forbidden - the
--      `app` schema is not exposed through the Data API.
--
-- THE GATE: ONLY A LIVE PROVIDER
--
-- `get_offer_tracking_target` refuses any offer whose provider is not LIVE, joining
-- `app.providers` and checking `lifecycle_state` server-side. That is the same rule
-- `public.list_live_offers` (migration 031) already applies to the inventory the user
-- sees, and it is why clicking an offer is impossible today: cpx_research is CANDIDATE.
--
-- This is deliberate. Issuance is the LAST step of the CR-0033 sequence and it stays
-- inert until the provider is promoted. Building it does not enable it.
--
-- WHY THE OFFER LOOKUP IS NOT SCOPED BY USER
--
-- Offers are provider-owned inventory, not user records, so there is no
-- "is this my row" property to check here. The `is_active` + LIVE join is the whole
-- access rule, and it is enforced in SQL rather than by trusting the caller.
--
-- `begin_provider_participation`, by contrast, IS user-owned, and the route that
-- calls it supplies the session user id. That id is never taken from a request body.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Read the destination for one offer.
-- -----------------------------------------------------------------------------
create or replace function public.get_offer_tracking_target(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  -- ACTIVE and LIVE only. A deactivated offer, or an offer belonging to a provider
  -- that is not LIVE, reads as ABSENT rather than FORBIDDEN - the caller learns
  -- nothing about inventory it may not offer.
  select jsonb_build_object(
    'providerCode', p.code,
    'externalOfferId', o.external_offer_id,
    'trackingBaseUrl', o.tracking_base_url
  )
  from app.offers o
  join app.providers p on p.id = o.provider_id
  where o.id = p_offer_id
    and o.is_active
    and p.lifecycle_state = 'LIVE';
$$;

revoke all on function public.get_offer_tracking_target(uuid)
  from public, anon, authenticated;
grant execute on function public.get_offer_tracking_target(uuid)
  to service_role;

comment on function public.get_offer_tracking_target(uuid) is
  'Returns the destination for one ACTIVE offer belonging to a LIVE provider. Returns '
  'NULL otherwise - never an error - so an absent offer is indistinguishable from an '
  'unavailable one. Refuses every offer whose provider is not LIVE (doc 13, doc 07).';


-- -----------------------------------------------------------------------------
-- Forwarding wrapper for the participation mint.
-- -----------------------------------------------------------------------------
--
-- Single-statement forwarder, exactly like migration 058. The privileged body stays in
-- `app_private`, where the CSPRNG mint and the ownership checks belong.
--
-- `p_user_id` comes from the verified session in the route handler, never from a
-- request body. That is the property that stops one signed-in user opening a
-- participation on behalf of another - the same scoping rule CR-0013 applied to
-- every read wrapper, applied here to a WRITE.
create or replace function public.begin_provider_participation(
  p_user_id uuid,
  p_offer_id uuid,
  p_survey_id uuid
)
returns text
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.begin_provider_participation(p_user_id, p_offer_id, p_survey_id);
$$;

revoke all on function public.begin_provider_participation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_provider_participation(uuid, uuid, uuid)
  to service_role;

comment on function public.begin_provider_participation(uuid, uuid, uuid) is
  'Opens a participation for p_user_id and returns a server-minted tracking id. The id '
  'is NEVER client-supplied: unpredictability is the entire mitigation for a vendor '
  'that signs only its transaction id (doc 13 TRACKING). Callers must pass the verified '
  'session user, never a user id from a request body.';