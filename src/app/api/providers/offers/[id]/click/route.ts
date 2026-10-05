import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter } from '@/lib/providers/registry';

// POST /api/providers/offers/[id]/click
//
// Hands a signed-in user the click-through URL for one offer, and records the
// participation that URL will later be attributed back to.
//
// WHY THIS EXISTS
//
// `subid_1` arrived EMPTY on the live CPX postback of 2026-10-04, so every conversion
// landed as evidence with `UNRESOLVED_TRACKING_ID`: CPX had no way to tell us which
// click it was reporting. This route is what makes that possible - it mints a tracking
// id and carries it in `subid_1`.
//
// THREE THINGS THIS ROUTE REFUSES TO DO
//
// 1. It never accepts a tracking id, a destination URL, or an amount from the client.
//    All three come from the database: the id is minted server-side by CSPRNG, the URL
//    comes from `offers.tracking_base_url`, and no money figure is involved at all.
//
// 2. It never takes a user id from the body. `user` is the verified session, so a caller
//    cannot open a participation on someone else's behalf.
//
// 3. It creates NO reward and touches no balance. Opening a link pays nothing. Doc 08
//    FINANCIAL BOUNDARY: a click is not a conversion, and a conversion is not a
//    settlement. All three are separate, and this is the first of them.
//
// STILL INERT WHILE THE PROVIDER IS NOT LIVE
//
// `public.get_offer_tracking_target` returns NULL unless the offer is active AND its
// provider is LIVE (migration 063). cpx_research is CANDIDATE, so this route currently
// returns 404 for every offer - which is correct, and is asserted in
// `supabase/tests/provider_attribution.sql`. Building the path is not the same as
// enabling it.

export const POST = route(async ({ user, params, correlationId }) => {
  const offerId = params.id;

  if (!offerId) {
    throw new RouteError('invalid_request', 'Unknown offer.');
  }

  const admin = createAdminClient();

  // Routed through `public.get_offer_tracking_target`, NOT `.from('offers')`. The
  // `app` schema is not exposed through the Data API.
  const { data: target } = await admin.rpc('get_offer_tracking_target', {
    p_offer_id: offerId,
  });

  // NULL is returned, not raised, for an offer that is absent, inactive, or belongs to
  // a provider that is not LIVE. All three read as "unknown offer" so this endpoint
  // cannot be used to probe which offers exist.
  if (!target) {
    throw new RouteError('not_found', 'That offer is not available.');
  }

  const row = target as Record<string, unknown>;
  const providerCode = String(row.providerCode ?? '');
  const externalOfferId = String(row.externalOfferId ?? '');
  const baseUrl = typeof row.trackingBaseUrl === 'string' ? row.trackingBaseUrl : null;

  const adapter = getAdapter(providerCode);

  // No `createTrackingLink` on the adapter means this vendor has no documented way to
  // carry a tracking id. Falling back to the raw offer URL would send the user onward
  // with no attribution at all - the exact `UNRESOLVED_TRACKING_ID` state this route
  // exists to end - so it is refused instead of degraded.
  if (!adapter?.createTrackingLink) {
    throw new RouteError('conflict', 'That offer cannot be opened right now.');
  }

  // `p_user_id` is the VERIFIED SESSION user. Never a body field.
  //
  // Routed through `public.begin_provider_participation`, which forwards to
  // `app_private.begin_provider_participation` - the same shape as migration 058's
  // wrappers, and for the same reason: PostgREST can only resolve an RPC against an
  // exposed schema.
  const { data: trackingId, error } = await admin.rpc('begin_provider_participation', {
    p_user_id: user!.id,
    p_offer_id: offerId,
    p_survey_id: null,
  });

  if (error || !trackingId) {
    console.error('[api] begin provider participation failed', {
      correlationId,
      offerId,
      error: error?.message,
    });
    throw new RouteError('internal_error', 'Could not open that offer.');
  }

  const link = await adapter.createTrackingLink({
    externalId: externalOfferId,
    trackingId: String(trackingId),
    userId: user!.id,
    baseUrl: baseUrl ?? undefined,
  });

  return NextResponse.json(
    {
      url: link.url,
      // Doc 09 TRANSPARENCY. Opening a link pays nothing, and nothing is guaranteed:
      // the provider decides whether the work is completed, and settlement decides
      // whether a reward becomes spendable.
      message:
        'Opening this link does not pay anything. A reward is only created if the provider reports a completed conversion, and only becomes spendable after their settlement is reconciled.',
    },
    { status: 201, headers: { 'x-correlation-id': correlationId } },
  );
});
