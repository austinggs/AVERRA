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
// TWO DIFFERENT HASHES OVER THE SAME SECRET
//
// CPX documents md5 hashes on BOTH directions and they are easy to conflate:
//
//   inbound  postback   md5(trans_id     + '-' + secret)   they send, we verify
//   outbound entry link md5(ext_user_id  + '-' + secret)   we send, CPX checks
//
// Only the inbound formula appears verbatim on the vendor's Postback Settings panel.
// The outbound one is quoted from https://cpx-research.com/main/en/doc.php. They are
// separate functions (`verifyCallback` / `cpxEntrySecureHash`) for that reason.
//
// THE SECRETS ARE READ LAZILY, INSIDE THE FUNCTIONS THAT USE THEM.
//
// `registry.ts` registers adapters at module load, and that runs during `next build`.
// A build-time read of a required variable fails the Vercel build with an error about
// a missing environment variable, which is a confusing way to learn a name is wrong.
// Reading them here means an unset value surfaces as `UNSUPPORTED` with a reason - the
// correct fail-closed outcome - and the build never depends on it.

import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  CallbackVerification,
  NormalizedCallbackEvent,
  ProviderAdapter,
  RawCallback,
  TrackingLink,
  TrackingLinkInput,
} from '@/lib/providers/types';
import { parseAmountMinor, requireString } from '@/lib/providers/normalize';
import {
  CPX_LOCAL_UNIT,
  classifyCpxEvent,
  cpxReversalEventId,
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
 * THE OUTBOUND ENTRY URL, PER CPX'S CURRENT DOCUMENTATION.
 *
 * From https://cpx-research.com/main/en/doc.php, IFRAME TAG documentation:
 *
 *     https://offers.cpx-research.com/index.php?app_id={app_id}
 *       &ext_user_id={unique_user_id}&secure_hash={secure_hash}
 *       &username={user_name}&email={user_email}&subid_1=&subid_2=
 *
 * and, for the secure hash:
 *
 *     "For higher security, you can add the secure hash parameter. You can generate
 *      it with your secure hash and the ext_user_id information
 *      (e.g. for php md5({unique_user_id}-{app_secure_hash}))"
 *
 * THIS IS A DIFFERENT HASH FROM THE INBOUND POSTBACK HASH, over a DIFFERENT input,
 * using the SAME shared secret. Conflating the two is the single most likely way to
 * "implement CPX" and have nothing work:
 *
 *   outbound (this function)  md5(ext_user_id + '-' + secret)   -> we SEND it
 *   inbound  (verifyCallback) md5(trans_id     + '-' + secret)   -> they SEND it
 *
 * Both were checked against the vendor's own screen; only the inbound one is quoted
 * on the Postback Settings panel, so the two are named separately here rather than
 * sharing one helper.
 *
 * `app_id` IS MANDATORY AND WAS MISSING. The previous implementation set `subid_1`
 * on the base URL and nothing else. CPX uses `app_id` to know WHICH APP the click
 * belongs to, so with it absent every click is unattributable to us no matter how
 * good the tracking id is. `ext_user_id` is likewise mandatory, must be unique per
 * user, and CPX documents it as the field "used for postback/s2s/webhook
 * communication".
 */

/** Builds the documented `secure_hash` for an entry link. */
export function cpxEntrySecureHash(extUserId: string, secret: string): string {
  return createHash('md5').update(`${extUserId}-${secret}`, 'utf8').digest('hex');
}

/**
 * CPX's published "Postback Whitelist IP" addresses.
 *
 * These are recorded as EVIDENCE and are deliberately NOT a gate.
 *
 * THE MD5 SIGNATURE IS THE AUTHENTICITY CHECK. The hash is computed with a shared
 * secret, so an IP gate adds no meaningful security. What it adds is a new way to
 * fail, and that is not hypothetical: a live CPX postback on 2026-10-04 arrived from
 * `44.204.183.114`, which is NOT in this list, while a genuine postback from
 * `157.90.97.92` is. The vendor's published list is therefore incomplete. Gating on it
 * would have dropped a real conversion with no error the provider could act on, and the
 * symptom is indistinguishable from "no conversions are happening" - the exact failure
 * mode this integration has already hit twice (CR-0030, and `amount_local` scaling).
 *
 * These addresses are compared against the REQUEST's remote address, never against
 * `ip_click`. See the note on the field name in `handleCallback`.
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

      // Two DIFFERENT addresses, and conflating them makes both useless.
      //
      // `ip_click` is the END USER's address at the moment they clicked through to the
      // survey. CPX documents it as "user click IP". On the live postback of
      // 2026-10-04 it was the publisher's own workstation, which is exactly what a test
      // click looks like - it is evidence about a person, not about the vendor.
      //
      // `input.remoteAddress` is the address the POSTBACK arrived from, i.e. CPX's own
      // server. That is the only thing the published whitelist can be compared against.
      //
      // Comparing the whitelist to `ip_click` reported `false` for essentially every
      // callback while appearing to be a source check. Both are now recorded, each
      // labelled for what it is.
      const clickIp = asText(input.body[FIELD.clickIp]);
      const postbackIp = input.remoteAddress ?? null;

      // A REVERSAL IS A DISTINCT EVENT AND GETS A DISTINCT IDENTITY.
      //
      // CPX re-notifies the same trans_id with status 2 or -2. Recording that under the
      // bare trans_id collided with law 5's unique index and the original conversion came
      // back as a DUPLICATE - so the fraud clawback was discarded with no reversal row and
      // no error anywhere. The suffixed id keeps the vendor's value verbatim, so `2` and
      // `-2` stay distinct, and a replayed reversal still collapses onto the same id.
      //
      // `reversesTransactionId` carries the BARE transaction id, which is what
      // `record_provider_conversion` resolves to the original row. It is the provider's
      // own identifier, not a conversion id, and it is never taken from a request body
      // field a caller controls beyond CPX's signature.
      const isReversal = kind.kind === 'REVERSAL';
      const eventId = isReversal
        ? cpxReversalEventId(transactionId.value, String(input.body[FIELD.status]).trim())
        : transactionId.value;

      return {
        providerEventId: eventId,
        reversesTransactionId: isReversal ? transactionId.value : null,
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
          // EVIDENCE ONLY. Never a gate - see CPX_POSTBACK_IPS.
          postbackSourceIp: postbackIp,
          postbackFromKnownSource: postbackIp !== null && CPX_POSTBACK_IPS.includes(postbackIp),
          // The end user's address, which is a different fact and a different machine.
          clickIp: clickIp ?? null,
          eventTimeProvidedByProvider: false,
        },
      };
    },

    /**
     * Builds the click-through URL for a survey, per CPX's CURRENT documentation.
     *
     * WHAT WAS MISSING, AND WHY IT MADE CPX UNUSABLE
     *
     * The previous version set `subid_1` and nothing else. CPX's documented entry URL
     * requires `app_id` and `ext_user_id` on EVERY integration method - iframe, script
     * tag and API - and CPX states `ext_user_id` "will also be used for
     * postback/s2s/webhook communication". Without `app_id` CPX cannot tell which app a
     * click belongs to, so nothing we send is attributable to us however good our
     * tracking id is. The link was well-formed and useless.
     *
     * THE THREE IDENTITIES, AND WHY THEY ARE DIFFERENT VALUES
     *
     *   ext_user_id  OUR user id. Mandatory, unique per user, and STABLE across
     *               sessions per CPX's own wording. CPX builds a respondent profile
     *               from it, so it must not change per click - a per-participation id
     *               here would give every user a fresh profile on every survey.
     *   subid_1      the per-click `tracking_id` minted by
     *               `begin_provider_participation`. This is what OUR ingest resolves
     *               the paying user from, through our own participation table.
     *   subid_2      free-form passthrough, unused by us today.
     *
     * `ext_user_id` is passed by the ROUTE from the VERIFIED SESSION, never from a
     * request body, so a client cannot mint a link that attributes someone else's
     * click. It is not a client-chosen value in any sense.
     *
     * THE SIGNATURE DOES NOT AUTHENTICATE EITHER FIELD
     *
     * CPX signs `md5(trans_id - secure_hash)` on the postback. Neither `ext_user_id`
     * nor `subid_1` is inside that input. A valid signature proves the callback came
     * from CPX; it does NOT prove the attribution fields inside it are the ones we
     * sent. The outbound `secure_hash` (md5 of ext_user_id + secret) binds the ENTRY
     * link to us for CPX's benefit, but CPX does not echo it back, so it is not a
     * verification mechanism on this side either.
     *
     * So attribution rests on: the tracking id being 128 CSPRNG bits minted
     * server-side and never chosen by a client, plus the settlement gate (migration
     * 059) which stops money leaving unless a report matches exactly. Do not describe
     * this as authenticated attribution. It is not.
     *
     * REFUSING TO BUILD A LINK WITH NO `app_id`
     *
     * Failing closed here is deliberate. A link missing the mandatory app id would send
     * a real user to CPX and produce an unattributable conversion - the silent failure
     * this whole path exists to prevent. An error the operator can see is strictly
     * better than traffic that looks like it worked.
     */
    createTrackingLink: async (input: TrackingLinkInput): Promise<TrackingLink> => {
      if (!input.baseUrl) {
        throw new Error(
          'cpx: no tracking base URL is configured for this offer, so no link can be built',
        );
      }

      // CPX requires app_id on every documented entry method. Read lazily, for the same
      // reason `secureHash()` is: `registry.ts` runs at module load during `next build`,
      // and a build-time throw about a missing env var is a confusing way to learn a
      // name is wrong.
      const appId = process.env.CPX_APP_ID?.trim();

      if (!appId) {
        throw new Error('cpx: CPX_APP_ID is not set, so no attributable link can be built');
      }

      // `ext_user_id` is mandatory AND must identify a real Averra user. A link without
      // it cannot be tied to an account, so it would be a conversion nobody could claim.
      if (!input.userId) {
        throw new Error('cpx: a verified user id is required to build an entry link');
      }

      const base = new URL(input.baseUrl);

      // Preserving any query the base URL already carries is why this goes through URL
      // rather than string concatenation - concatenating onto a URL that already has a
      // `?` produces a broken second query.
      base.searchParams.set('app_id', appId);
      base.searchParams.set('ext_user_id', input.userId);

      // The documented outbound hash. Same secret as the inbound postback hash, different
      // input, so it is computed here rather than reused from verifyCallback.
      const secret = secureHash();

      if (secret) {
        base.searchParams.set('secure_hash', cpxEntrySecureHash(input.userId, secret));
      }

      // The per-click tracking id, which OUR ingest resolves the paying user from.
      base.searchParams.set('subid_1', input.trackingId);

      return {
        trackingId: input.trackingId,
        url: base.toString(),
      };
    },
  };
}
