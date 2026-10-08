// Reference provider adapter.
//
// WHY THIS EXISTS AND WHY IT IS NOT A VENDOR
//
// No provider may be LIVE without the doc 07 decision gates, and none have been
// performed. This adapter therefore implements the FULL doc 08 interface against
// deterministic local fixtures, so the ingestion, normalization, reward-bridge
// and reconciliation paths are provably exercised end to end without inventing
// any real vendor's signature scheme or postback format.
//
// Doc 78 forbids inventing provider behaviour. A real vendor adapter is written
// only against that vendor's own published documentation, by someone who has
// tested it in the vendor's sandbox. Until then, this adapter is how the
// pipeline is proven.

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  canProduceReward,
  type CallbackVerification,
  type ConversionStatus,
  type NormalizationResult,
  type NormalizedCallbackEvent,
  type ProviderAdapter,
  type RawCallback,
  type TrackingLink,
  type TrackingLinkInput,
} from '@/lib/providers/types';
import {
  checkTimestamp,
  normalizeStatus,
  parseAmountMinor,
  requireString,
} from '@/lib/providers/normalize';

/** Fixture field names. Deliberately neutral: not a real vendor's format. */
const FIELDS = {
  eventId: 'event_id',
  eventType: 'event_type',
  status: 'status',
  amount: 'amount',
  currency: 'currency',
  timestamp: 'event_time',
  trackingId: 'tracking_id',
  campaign: 'campaign_id',
  signature: 'signature',
} as const;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

/**
 * Builds a reference adapter bound to a shared secret.
 *
 * The secret is supplied per deployment, never compiled in. A callback whose
 * secret is unconfigured is UNSUPPORTED, not VERIFIED: an adapter that cannot
 * authenticate must fail closed (law 4).
 */
export function createReferenceAdapter(secret: string | null): ProviderAdapter {
  const computeSignature = (rawBody: string): string =>
    createHmac('sha256', secret ?? 'unset')
      .update(rawBody, 'utf8')
      .digest('hex');

  return {
    /**
     * The fixture names its own event id `event_id` (see FIELDS above). Declared here
     * rather than defaulted in the ingestion path so that the shared code has no
     * opinion about any provider's wire format.
     */
    claimedEventIdFields: () => [FIELDS.eventId],
    /**
     * HMAC-SHA256 over the raw body. This is a REFERENCE scheme chosen because
     * it is standard and testable, NOT because any real provider uses it.
     */
    verifyCallback: async (input: RawCallback): Promise<CallbackVerification> => {
      if (!secret) {
        return {
          result: 'UNSUPPORTED',
          reason: 'no verification secret is configured for this provider',
        };
      }

      const provided = input.body[FIELDS.signature];

      if (typeof provided !== 'string' || provided.length === 0) {
        return { result: 'ABSENT', reason: 'callback carried no signature' };
      }

      if (!safeEqual(provided, computeSignature(input.rawBody))) {
        return { result: 'FAILED', reason: 'signature did not verify' };
      }

      const claimed = input.body[FIELDS.timestamp];
      const claimedTimestamp = typeof claimed === 'string' ? new Date(claimed) : null;

      return {
        result: 'VERIFIED',
        algorithm: 'hmac-sha256',
        claimedTimestamp:
          claimedTimestamp && !Number.isNaN(claimedTimestamp.getTime()) ? claimedTimestamp : null,
      };
    },

    handleCallback: async (input: RawCallback): Promise<NormalizedCallbackEvent | null> => {
      const eventId = requireString(input.body, FIELDS.eventId);
      if (!eventId.ok) return null;

      const eventType = requireString(input.body, FIELDS.eventType);
      if (!eventType.ok) return null;

      const status = normalizeStatus(input.body[FIELDS.status]);
      if (!status.ok) return null;

      // Amount is optional. A completion event may carry no figure; a
      // MALFORMED one is rejected rather than defaulted to zero.
      let amountMinor: bigint | null = null;
      if (input.body[FIELDS.amount] !== undefined) {
        const amount = parseAmountMinor(input.body[FIELDS.amount]);
        if (!amount.ok) return null;
        amountMinor = amount.value;
      }

      const currencyRaw = input.body[FIELDS.currency];
      const currency =
        typeof currencyRaw === 'string' && currencyRaw.trim().length > 0
          ? currencyRaw.trim().toUpperCase()
          : null;

      const timestampRaw = input.body[FIELDS.timestamp];
      const eventTimestamp = typeof timestampRaw === 'string' ? new Date(timestampRaw) : null;

      const trackingRaw = input.body[FIELDS.trackingId];
      const trackingId =
        typeof trackingRaw === 'string' && trackingRaw.trim().length > 0
          ? trackingRaw.trim()
          : null;

      return {
        providerEventId: eventId.value,
        sourceType: 'OFFER',
        campaignRef: null,
        userId: null,
        trackingId,
        eventType: eventType.value,
        status: status.value as ConversionStatus,
        grossValueMinor: amountMinor,
        currency,
        eventTimestamp:
          eventTimestamp && !Number.isNaN(eventTimestamp.getTime()) ? eventTimestamp : null,
        normalizedPayload: { source: 'reference_adapter' },
      };
    },

    createTrackingLink: async (input: TrackingLinkInput): Promise<TrackingLink> => {
      const sub = input.subId ? `&subid=${encodeURIComponent(input.subId)}` : '';

      return {
        trackingId: input.trackingId,
        url:
          `https://example.invalid/offers/${encodeURIComponent(input.externalId)}` +
          `?tid=${encodeURIComponent(input.trackingId)}${sub}`,
      };
    },

    /**
     * Signs a payload the way the reference scheme does. Exposed so tests and
     * local fixtures can produce a valid callback without duplicating the HMAC
     * construction. NOT for production use.
     */
    __signForTesting: (rawBody: string): string => computeSignature(rawBody),
  } as ProviderAdapter;
}

export { canProduceReward, checkTimestamp };
