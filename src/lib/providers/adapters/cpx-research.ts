// CPX Research adapter.
//
// Written against CPX's OWN publisher documentation, not a guess.
//
// SIGNATURE - taken verbatim from the INFORMATION panel of the publisher's
// Postback Settings screen:
//
//     "hash is a md5 hash: example: md5({trans_id}-yourappsecurehash)"
//
// so the separator is a HYPHEN and the signed input is the transaction id only. Four
// external sources were checked before trusting this and they disagreed - one
// production integration reported `md5(trans_id + secure_hash)`, a second sample
// verified nothing at all, and the largest network running CPX documents no postback
// hash. A guess would have failed CLOSED, and closed here means every real conversion
// silently rejected while the dashboard reads "no earnings yet". The vendor's own
// screen is the only authority that settles it.
//
// DOC 78 FORBIDS INVENTING PROVIDER BEHAVIOUR. Every field name below is a
// placeholder CPX publishes: status, type, trans_id, user_id, subid_1, subid_2,
// amount_local, amount_usd, offer_id, ip_click, hash.
//
// THE SECRET IS READ LAZILY, INSIDE verifyCallback.
//
// `registry.ts` registers adapters at module load, and that runs during `next build`.
// A build-time read of a required variable fails the Vercel build with an error about
// a missing environment variable, which is a confusing way to learn a name is wrong.
// Reading it here means an unset value surfaces as `UNSUPPORTED` with a reason - the
// correct fail-closed outcome - and the build never depends on it.

import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  CallbackVerification,
  NormalizedCallbackEvent,
  ProviderAdapter,
  RawCallback,
} from '@/lib/providers/types';
import { parseAmountMinor, requireString } from '@/lib/providers/normalize';
import {
  CPX_LOCAL_UNIT,
  classifyCpxEvent,
  decimalToMinor,
} from '@/lib/providers/adapters/cpx-contract';

/** Documented CPX postback fields. */
const FIELD = {
  status: 'status',
  type: 'type',
  transactionId: 'trans_id',
  userId: 'user_id',
  subid1: 'subid_1',
  subid2: 'subid_2',
  amountLocal: 'amount_local',
  amountUsd: 'amount_usd',
  offerId: 'offer_id',
  clickIp: 'ip_click',
  hash: 'hash',
} as const;

/**
 * The value a reviewer may want when auditing a rejected callback.
 *
 * CPX publishes these as "Postback Whitelist IP". They are recorded as EVIDENCE and
 * are deliberately NOT a gate.
 *
 * The MD5 signature is already a cryptographic check with a shared secret, so an IP
 * gate adds no meaningful security. What it does add is a new way to fail: if CPX
 * ever changes an address, every callback is dropped with no error the provider can
 * act on, and the symptom is indistinguishable from "no conversions are happening".
 * That is the exact failure mode this integration has already hit twice.
 */
export const CPX_POSTBACK_IPS = ['188.40.3.73', '157.90.97.92', '2a01:4f8:d0a:30ff:2'];

function secureHash(): string | null {
  const value = process.env.CPX_SECURE_HASH;
  return value && value.length > 0 ? value : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on a length mismatch, and the length of a hash is itself
  // not a secret, so the short-circuit is safe and avoids turning a bad request into
  // a 500.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

/** md5(trans_id + '-' + secret), per CPX's documented example. */
function computeHash(transId: string, secret: string): string {
  return createHash('md5').update(`${transId}-${secret}`, 'utf8').digest('hex');
}

/** A string field, or null. Anything non-string is recorded as absent, not coerced. */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function createCpxAdapter(): ProviderAdapter {
  return {
    verifyCallback: async (input: RawCallback): Promise<CallbackVerification> => {
      const secret = secureHash();

      if (!secret) {
        // Fail closed. An unconfigured provider must not accept traffic that appears
        // authentic (law 4).
        return {
          result: 'UNSUPPORTED',
          reason: 'CPX_SECURE_HASH is not configured, so no CPX callback can be authenticated',
        };
      }

      const transId = requireString(input.body, FIELD.transactionId);
      if (!transId.ok) {
        return { result: 'FAILED', reason: `callback carried no ${FIELD.transactionId}` };
      }

      const provided = input.body[FIELD.hash];
      if (typeof provided !== 'string' || provided.trim().length === 0) {
        return { result: 'ABSENT', reason: `callback carried no ${FIELD.hash}` };
      }

      if (!safeEqual(provided.trim().toLowerCase(), computeHash(transId.value, secret))) {
        return { result: 'FAILED', reason: 'cpx postback hash did not verify' };
      }

      return { result: 'VERIFIED', algorithm: 'md5(trans_id-secure_hash)' };
    },

    handleCallback: async (input: RawCallback): Promise<NormalizedCallbackEvent | null> => {
      const transactionId = requireString(input.body, FIELD.transactionId);
      if (!transactionId.ok) return null;

      const kind = classifyCpxEvent(input.body[FIELD.status], input.body[FIELD.type]);

      // An unrecognised pair is refused, not guessed. It still reaches the evidence
      // table, because verification passed before normalization ran.
      if (!kind.conversionStatus) return null;

      // `amount_local` is the provider's figure in OUR configured currency (NGN at
      // 1325.29 per USD), converted here to kobo. `amount_usd` is retained in the
      // normalized payload for audit: the two will not agree, because CPX rounds the
      // local amount to two decimals, and that drift should be visible rather than
      // lost.
      const amountResult = decimalToMinor(input.body[FIELD.amountLocal]);

      // A malformed amount is a REFUSAL, never a default of zero. A zero would create
      // a real reward row worth nothing and look like a successful conversion.
      if (!amountResult.ok) return null;

      // Re-parsed through the shared parser as an integer, which keeps its own
      // guarantees on everything else.
      const amount = parseAmountMinor(amountResult.value.toString());
      if (!amount.ok) return null;

      const usdRaw = input.body[FIELD.amountUsd];
      const amountUsd = typeof usdRaw === 'string' ? decimalToMinor(usdRaw) : null;

      const clickIp = String(input.body[FIELD.clickIp] ?? '');

      return {
        providerEventId: transactionId.value,
        sourceType: 'SURVEY',
        // The campaign reference is their offer id, which is a provider-side concept.
        campaignRef: asText(input.body[FIELD.offerId]),
        // CPX's `user_id` is OUR identifier, echoed back. Recorded for correlation
        // ONLY. The ingest layer resolves the paying user from our own tracking table
        // and never from a provider assertion.
        userId: asText(input.body[FIELD.userId]),
        trackingId: asText(input.body[FIELD.subid1]),
        eventType: `cpx:${String(input.body[FIELD.type] ?? 'unknown')}`,
        status: kind.conversionStatus,
        grossValueMinor: amount.value,
        currency: CPX_LOCAL_UNIT,
        // CPX's documented postback carries NO timestamp placeholder. Claiming one
        // would invent evidence, so the arrival time is used and the payload records
        // that the event time is unverified.
        eventTimestamp: input.receivedAt,
        normalizedPayload: {
          provider: 'cpx_research',
          kind: kind.kind,
          reason: kind.reason ?? null,
          amountUsdMinor: amountUsd?.ok ? amountUsd.value.toString() : null,
          subid2: asText(input.body[FIELD.subid2]),
          clickIp: clickIp || null,
          knownPostbackIp: CPX_POSTBACK_IPS.includes(clickIp),
          eventTimeProvidedByProvider: false,
        },
      };
    },
  };
}
