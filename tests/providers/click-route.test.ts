import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/providers/offers/[id]/click
//
// The route that hands a user a click-through URL carrying `subid_1`. Empty `subid_1`
// is why every live CPX conversion so far landed as `UNRESOLVED_TRACKING_ID`, so this
// route is what makes attribution possible at all.
//
// WHAT IS ACTUALLY WORTH TESTING HERE
//
// The adapter's URL building is covered by cpx-research.test.ts. What only this suite
// can prove is the ROUTE'S decision boundary:
//
//   1. an unauthenticated caller is refused (fail closed);
//   2. a user id is never read from the request body - only from the session;
//   3. an offer whose provider is not LIVE yields 404, so the route is inert while
//      cpx_research is CANDIDATE;
//   4. the tracking id in the returned URL is the one the DATABASE minted, not anything
//      the client supplied.
//
// `server-only` is mocked because the shared `route()` helper imports it and a test is
// not the server. That is the only reason; the route's real database calls are mocked
// so what is under test is the decision, not Postgres.

vi.mock('server-only', () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: sessionMock,
}));

const route = await import('@/app/api/providers/offers/[id]/click/route');

const USER_ID = '44444444-4444-4444-4444-444444444444';
const MINTED_TRACKING_ID = 'av_0123456789abcdef0123456789abcdef';

function context(id = 'offer-1') {
  return { params: Promise.resolve({ id }) };
}

function request(body?: unknown): Request {
  return new Request('https://vip-averra.vercel.app/api/providers/offers/offer-1/click', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The happy-path target: an ACTIVE offer of a LIVE provider. */
const LIVE_TARGET = {
  providerCode: 'cpx_research',
  externalOfferId: '123',
  trackingBaseUrl: 'https://offers.cpx-research.invalid/click',
};

/** get_offer_tracking_target resolves; the mint returns the server-minted id. */
function mockLiveOffer() {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === 'get_offer_tracking_target') return { data: LIVE_TARGET, error: null };
    return { data: MINTED_TRACKING_ID, error: null };
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  sessionMock.mockReset();
  sessionMock.mockResolvedValue({ id: USER_ID });
});

describe('POST /api/providers/offers/[id]/click', () => {
  it('refuses an unauthenticated caller', async () => {
    sessionMock.mockResolvedValue(null);

    const response = await route.POST(request(), context());

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // THE GATE. While cpx_research is CANDIDATE, `get_offer_tracking_target` returns
  // NULL for every offer, so no click-through is possible. Building the path is not the
  // same as enabling it.
  it('returns 404 when the offer has no tracking target (provider not LIVE)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const response = await route.POST(request(), context());

    expect(response.status).toBe(404);
    // And no participation was opened. Nothing half-done.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown offer id', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const response = await route.POST(request(), context('no-such-offer'));

    expect(response.status).toBe(404);
  });

  // THE SECURITY PROPERTY. The user id comes from the verified session, so a caller
  // cannot open a participation on someone else's behalf.
  it('uses the SESSION user id, never a user id from the body', async () => {
    mockLiveOffer();

    // A body naming a DIFFERENT user. The route must ignore it entirely.
    const response = await route.POST(
      request({ userId: '99999999-9999-9999-9999-999999999999', trackingId: 'client-chosen' }),
      context(),
    );

    expect(response.status).toBe(201);

    const beginCall = rpcMock.mock.calls.find((call) => call[0] === 'begin_provider_participation');
    expect(beginCall).toBeDefined();
    const args = beginCall![1] as Record<string, unknown>;

    // The session user, NOT the body user.
    expect(args.p_user_id).toBe(USER_ID);
    expect(args.p_user_id).not.toBe('99999999-9999-9999-9999-999999999999');
    // And the tracking id is not a parameter at all, so a client cannot supply one.
    expect(Object.keys(args)).not.toContain('p_tracking_id');
  });

  // The tracking id in the URL is the one the DATABASE returned. A client-supplied one
  // would be guessable by construction, which is the entire property this relies on.
  it('carries the DATABASE-minted tracking id, not a client-supplied one', async () => {
    mockLiveOffer();

    const response = await route.POST(request({ trackingId: 'av_clientchosen' }), context());
    const payload = (await response.json()) as { url: string };

    expect(new URL(payload.url).searchParams.get('subid_1')).toBe(MINTED_TRACKING_ID);
    expect(payload.url).not.toContain('av_clientchosen');
  });

  // Doc 09 TRANSPARENCY. The response must not imply that clicking pays.
  it('does not describe the click as a payment', async () => {
    mockLiveOffer();

    const response = await route.POST(request(), context());
    const payload = (await response.json()) as { message: string };

    expect(payload.message).toMatch(/does not pay/i);
  });

  // A LIVE offer resolves end to end: a 201 whose URL carries the tracking id.
  it('issues a link for an ACTIVE offer of a LIVE provider', async () => {
    mockLiveOffer();

    const response = await route.POST(request(), context());
    const payload = (await response.json()) as { url: string };

    expect(response.status).toBe(201);
    expect(new URL(payload.url).host).toBe('offers.cpx-research.invalid');
    expect(new URL(payload.url).searchParams.get('subid_1')).toBe(MINTED_TRACKING_ID);
  });
});
