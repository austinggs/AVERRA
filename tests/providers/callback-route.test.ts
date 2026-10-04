import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The route is the ONLY place both verbs converge, so it is the only place that can
// prove they share a reader. Testing the adapter and the path allowlist separately
// cannot: a second reader on one verb would satisfy both of those suites while
// evidence silently diverged. That is exactly what happened when this route was
// POST-only and CPX used GET - 405, no evidence, no error anywhere.
//
// `ingest` is mocked rather than exercised for real. It opens a service-role database
// connection, and what is under test is the SHAPE OF WHAT REACHES IT: the parsed body,
// the verb, the remote address, and that there is exactly one call.

const ingestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/providers/ingest', () => ({
  ingestProviderCallback: ingestMock,
}));

vi.mock('@/lib/providers/evidence', () => ({
  newCorrelationId: () => '11111111-1111-1111-1111-111111111111',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

vi.mock('@/lib/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const route = await import('@/app/api/providers/callbacks/[provider]/route');

/** A CPX-shaped query string, matching the live postback of 2026-10-04. */
const CPX_QUERY =
  'status=1&type=complete&trans_id=1001228131380&user_id=averra-test-0001' +
  '&subid_1=&subid_2=&amount_local=662.6500&amount_usd=0.50&offer_id=1' +
  '&hash=7750f4e74fa3020a3a629af57856d75e&ip_click=105.127.16.184';

function context(provider = 'cpx_research') {
  return { params: Promise.resolve({ provider }) };
}

function getRequest(query = CPX_QUERY): Request {
  return new Request(
    `https://vip-averra.vercel.app/api/providers/callbacks/cpx_research?${query}`,
    { method: 'GET', headers: { 'x-forwarded-for': '157.90.97.92, 10.0.0.1' } },
  );
}

function postRequest(body = CPX_QUERY): Request {
  return new Request('https://vip-averra.vercel.app/api/providers/callbacks/cpx_research', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '157.90.97.92, 10.0.0.1',
    },
    body,
  });
}

/** Typed view of the ingest call, so `noUncheckedIndexedAccess` cannot hide a missing call. */
type IngestCall = {
  providerCode: string;
  parsedBody: Record<string, unknown>;
  rawBody: string;
  remoteAddress: string | null;
};

function callAt(index: number): IngestCall {
  const call = ingestMock.mock.calls[index]?.[0] as IngestCall | undefined;
  if (!call) throw new Error(`ingest was not called ${index + 1} time(s)`);
  return call;
}

beforeEach(() => {
  ingestMock.mockReset();
  // No funding source, so the route records the conversion and stops. Nothing may pay
  // while the provider is CANDIDATE.
  ingestMock.mockResolvedValue({
    outcome: 'ACCEPTED',
    conversionId: '22222222-2222-2222-2222-222222222222',
    eligibleForReward: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// THE POINT OF THIS SUITE: both verbs reach ONE ingest call with ONE body shape.
describe('provider callback route accepts both verbs through one path', () => {
  it('ingests a GET query-string postback', async () => {
    const response = await route.GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledTimes(1);
  });

  it('ingests a POST form postback', async () => {
    const response = await route.POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledTimes(1);
  });

  // The regression this file exists for. A GET against a POST-only handler returns 405
  // and the callback is never ingested, which is indistinguishable from a provider that
  // has stopped sending.
  it('never answers 405, which is what silently ate every CPX callback', async () => {
    const get = await route.GET(getRequest(), context());
    const post = await route.POST(postRequest(), context());

    expect(get.status).not.toBe(405);
    expect(post.status).not.toBe(405);
  });

  // Both verbs must produce the SAME parsed body. If GET dropped a field that POST kept,
  // evidence would differ by verb and no adapter-level test would notice.
  it('produces an identical parsed body for both verbs', async () => {
    await route.GET(getRequest(), context());
    await route.POST(postRequest(), context());

    expect(callAt(0).parsedBody).toEqual(callAt(1).parsedBody);
    expect(callAt(0).parsedBody).toMatchObject({
      status: '1',
      type: 'complete',
      trans_id: '1001228131380',
      amount_local: '662.6500',
    });
  });

  it('passes the provider code through from the URL segment', async () => {
    await route.GET(getRequest(), context('cpx_research'));
    expect(callAt(0).providerCode).toBe('cpx_research');
  });

  // The evidence column is the only place a source address survives, so losing it here
  // would undo the CPX_POSTBACK_IPS fix one layer up.
  it('records the trusted remote address, taking the FIRST forwarded hop', async () => {
    await route.GET(getRequest(), context());
    expect(callAt(0).remoteAddress).toBe('157.90.97.92');
  });

  it('keeps the raw bytes as received rather than a re-serialisation', async () => {
    await route.GET(getRequest(), context());
    expect(callAt(0).rawBody).toBe(`?${CPX_QUERY}`);

    await route.POST(postRequest(), context());
    expect(callAt(1).rawBody).toBe(CPX_QUERY);
  });
});
