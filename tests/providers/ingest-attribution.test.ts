import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ingest attribution wiring (Q-45).
//
// Migration 060 built the liveness-aware `resolve_tracking_user_for_attribution`
// and its comment claimed the ingest path routes through it. It did not:
// `ingestProviderCallback` still called migration 034's `resolve_tracking_user`,
// which has no status filter and resolves ANY participation row, live or dead.

vi.mock('server-only', () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn());
const adapterMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

vi.mock('@/lib/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/registry', () => ({
  getAdapter: adapterMock,
}));

vi.mock('@/lib/providers/evidence', () => ({
  recordCallbackEvidence: vi.fn(async () => 999),
  recordCallbackOutcome: outcomeMock,
  newCorrelationId: () => '99999999-9999-9999-9999-999999999999',
  toRawCallback: (args: {
    providerCode: string;
    rawBody: string;
    parsedBody: Record<string, unknown>;
    headers: Record<string, string>;
    signature: string | null;
    remoteAddress: string | null;
  }) => ({
    providerCode: args.providerCode,
    body: args.parsedBody,
    rawBody: args.rawBody,
    headers: args.headers,
    receivedAt: new Date(),
    remoteAddress: args.remoteAddress,
    signature: args.signature,
  }),
  applyProviderReversal: vi.fn(),
}));

const { ingestProviderCallback } = await import('@/lib/providers/ingest');

const PROVIDER_ID = '55555555-5555-5555-5555-555555555555';
const TRACKING_ID = 'av_0123456789abcdef0123456789abcdef';
const USER_ID = '66666666-6666-6666-6666-666666666666';
const CONVERSION_ID = '77777777-7777-7777-7777-777777777777';

function mockAdapter() {
  adapterMock.mockReturnValue({
    verifyCallback: async () => ({ result: 'VERIFIED' }),
    handleCallback: async () => ({
      providerEventId: '1001228131380',
      reversesTransactionId: null,
      sourceType: 'SURVEY',
      campaignRef: null,
      userId: null,
      trackingId: TRACKING_ID,
      eventType: 'SURVEY_COMPLETE',
      status: 'VALIDATED',
      grossValueMinor: 50n,
      currency: 'USD',
      eventTimestamp: new Date(),
      normalizedPayload: {},
    }),
  });
}

function mockDb(resolvedUser: string | null) {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === 'list_providers') {
      return {
        data: [{ id: PROVIDER_ID, code: 'cpx_research', status: 'LIVE' }],
        error: null,
      };
    }
    if (fn === 'get_conversion_for_event') return { data: null, error: null };
    if (fn === 'resolve_tracking_user_for_attribution') return { data: resolvedUser, error: null };
    if (fn === 'record_provider_conversion') {
      return { data: { id: CONVERSION_ID, isDuplicate: false }, error: null };
    }
    throw new Error(`unexpected rpc call: ${fn}`);
  });
}

function input() {
  return {
    providerCode: 'cpx_research',
    rawBody: 'status=1&trans_id=1001228131380',
    parsedBody: { status: '1', trans_id: '1001228131380' },
    headers: {},
    signature: null,
    remoteAddress: '44.204.183.114',
    correlationId: '88888888-8888-8888-8888-888888888888',
  };
}

beforeEach(() => {
  rpcMock.mockReset();
  outcomeMock.mockReset();
  adapterMock.mockReset();
  mockAdapter();
});

describe('ingest attribution wiring', () => {
  it('resolves the user through the liveness-aware wrapper', async () => {
    mockDb(USER_ID);

    const result = await ingestProviderCallback(input());

    expect(result).toEqual({
      outcome: 'ACCEPTED',
      conversionId: CONVERSION_ID,
      eligibleForReward: true,
    });
    expect(rpcMock).toHaveBeenCalledWith('resolve_tracking_user_for_attribution', {
      p_provider_id: PROVIDER_ID,
      p_tracking_id: TRACKING_ID,
    });

    const recordCall = rpcMock.mock.calls.find((call) => call[0] === 'record_provider_conversion');
    expect(recordCall?.[1]).toMatchObject({ p_user_id: USER_ID, p_tracking_id: TRACKING_ID });
  });

  it('never calls the legacy resolver', async () => {
    mockDb(USER_ID);

    await ingestProviderCallback(input());

    // EXACT equality, not a substring: the new name CONTAINS the old one, so an
    // `includes` check would pass on the very defect this test catches.
    const legacyCalls = rpcMock.mock.calls.filter((call) => call[0] === 'resolve_tracking_user');
    expect(legacyCalls).toHaveLength(0);
  });

  it('records a dead participation as unresolved rather than dropping it', async () => {
    // The database answers nobody: this is what the liveness-aware wrapper
    // returns for a participation that is no longer STARTED or QUALIFIED.
    mockDb(null);

    const result = await ingestProviderCallback(input());

    expect(result).toEqual({
      outcome: 'ACCEPTED',
      conversionId: CONVERSION_ID,
      eligibleForReward: false,
    });
    expect(outcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'UNRESOLVED_TRACKING_ID' }),
    );
  });
});
