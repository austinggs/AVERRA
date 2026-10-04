import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/observability/logger';
import { errorFields } from '@/lib/observability/errors';
import {
  canProduceReward,
  type NormalizedCallbackEvent,
  type ProviderState,
} from '@/lib/providers/types';
import { checkTimestamp } from '@/lib/providers/normalize';
import { getAdapter } from '@/lib/providers/registry';
import {
  newCorrelationId,
  recordCallbackEvidence,
  recordCallbackOutcome,
  toRawCallback,
} from '@/lib/providers/evidence';

// Provider callback ingestion (doc 08 CALLBACK REQUIREMENTS).
//
// The seven required checks, and where each happens:
//
//   1. authenticate origin     -> the provider row must exist and resolve
//   2. validate signature       -> adapter.verifyCallback, must fail closed
//   3. validate required fields -> adapter.handleCallback, which returns null
//                                  on anything it cannot interpret
//   4. validate identifiers     -> provider_event_id required; the USER is
//                                  resolved from our own tracking table, never
//                                  from anything the provider asserts
//   5. timestamp/replay window  -> checkTimestamp, plus event-level uniqueness
//   6. apply idempotency        -> uq_provider_conversions_event, enforced in SQL
//   7. record raw evidence      -> written before any verdict is acted on
//
// Ordering is deliberate: evidence is persisted first, so a rejected callback is
// still auditable.

export type IngestResult =
  | { outcome: 'ACCEPTED'; conversionId: string; eligibleForReward: boolean }
  | { outcome: 'DUPLICATE'; conversionId: string }
  | { outcome: 'REJECTED'; reason: string; verification: string };

export type IngestInput = {
  providerCode: string;
  rawBody: string;
  parsedBody: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string | null;
  remoteAddress?: string | null;
  correlationId?: string;
};

/**
 * The provider's own identifier for this event, as claimed in the payload.
 *
 * THE GENERIC `event_id` NAME IS NOT ENOUGH. CPX Research sends its transaction id as
 * `trans_id` and never sends `event_id`, so on the live postback of 2026-10-04 this
 * function returned null for a signature-VERIFIED callback. The vendor's id therefore
 * never reached `provider_callbacks.claimed_event_id`, and reconciling a CPX payout
 * dispute meant digging through `raw_payload` by hand.
 *
 * `trans_id` is checked alongside `event_id` because it is a documented CPX postback
 * placeholder, not an invented name. It is recorded as EVIDENCE either way: nothing
 * downstream trusts this value to identify a paying user, and the reward path resolves
 * the user from our own tracking table.
 */
function readClaimedEventId(body: Record<string, unknown>): string | null {
  for (const field of ['event_id', 'trans_id']) {
    const value = body[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
}

export async function ingestProviderCallback(input: IngestInput): Promise<IngestResult> {
  const admin = createAdminClient();
  const now = new Date();
  const correlationId = input.correlationId ?? newCorrelationId();
  const remoteAddress = input.remoteAddress ?? null;

  // 1. AUTHENTICATE ORIGIN.
  // Routed through `public.list_providers`, NOT `.from('providers')`.
  //
  // The `app` schema is not exposed through the Data API, so a PostgREST read of
  // app.providers fails with PGRST205. The list is small (fourteen seeded codes,
  // every one a CANDIDATE), so filtering in memory is cheaper than a per-code
  // RPC and keeps the lookup on a single round trip.
  const { data: providerRows, error: providerError } = await admin.rpc('list_providers');

  if (providerError) {
    logger.error(
      'provider.ingest_provider_read_failed',
      errorFields(providerError, { providerCode: input.providerCode }),
    );
    return { outcome: 'REJECTED', reason: 'provider lookup failed', verification: 'UNKNOWN' };
  }

  const provider = (
    (providerRows ?? []) as Array<{ id: string; code: string; status: string }>
  ).find((row) => row.code === input.providerCode);

  if (!provider) {
    logger.warn('provider.ingest_unknown_provider', { providerCode: input.providerCode });
    return { outcome: 'REJECTED', reason: 'unknown provider', verification: 'UNKNOWN' };
  }

  const providerId = provider.id;
  const adapter = getAdapter(input.providerCode);

  if (!adapter?.verifyCallback || !adapter.handleCallback) {
    logger.warn('provider.ingest_no_adapter', { providerCode: input.providerCode });
    return { outcome: 'REJECTED', reason: 'no adapter is registered', verification: 'UNSUPPORTED' };
  }

  const raw = toRawCallback({
    providerCode: input.providerCode,
    rawBody: input.rawBody,
    parsedBody: input.parsedBody,
    headers: input.headers,
    signature: input.signature,
    remoteAddress,
  });

  // 2. VALIDATE SIGNATURE, failing closed.
  const verification = await adapter.verifyCallback(raw);

  if (verification.result !== 'VERIFIED') {
    // 7. Record raw evidence even though we are rejecting it.
    await recordCallbackEvidence({
      providerId,
      rawBody: input.rawBody,
      parsedBody: input.parsedBody,
      headers: input.headers,
      signature: input.signature,
      remoteAddress,
      verificationResult: verification.result,
      verificationReason: verification.reason ?? null,
      algorithm: verification.algorithm ?? null,
      claimedEventId: readClaimedEventId(input.parsedBody),
      claimedTimestamp: verification.claimedTimestamp ?? null,
      correlationId,
    });

    logger.warn('provider.callback_unverified', {
      providerCode: input.providerCode,
      verification: verification.result,
    });

    return {
      outcome: 'REJECTED',
      reason: verification.reason ?? 'callback failed verification',
      verification: verification.result,
    };
  }

  // 3. VALIDATE REQUIRED FIELDS. The adapter returns null rather than guessing.
  const normalized = await adapter.handleCallback(raw);

  const timestampCheck = normalized
    ? checkTimestamp(normalized.eventTimestamp, now)
    : { ok: false as const, reason: 'normalization failed' };

  // 7. Evidence is captured for the verified path too, before any verdict.
  const evidenceId = await recordCallbackEvidence({
    providerId,
    rawBody: input.rawBody,
    parsedBody: input.parsedBody,
    headers: input.headers,
    signature: input.signature,
    remoteAddress,
    verificationResult: 'VERIFIED',
    verificationReason: timestampCheck.ok ? null : timestampCheck.reason,
    algorithm: verification.algorithm ?? null,
    claimedEventId: normalized ? normalized.providerEventId : readClaimedEventId(input.parsedBody),
    claimedTimestamp: normalized?.eventTimestamp ?? verification.claimedTimestamp ?? null,
    correlationId,
  });

  // A caller that cannot record what it received must not act on it.
  if (!evidenceId) {
    return { outcome: 'REJECTED', reason: 'could not record evidence', verification: 'VERIFIED' };
  }

  if (!normalized) {
    await recordCallbackOutcome({
      callbackId: evidenceId,
      processingResult: 'REJECTED',
      reasonCode: 'NORMALIZATION_FAILED',
      conversionId: null,
      correlationId,
    });

    return {
      outcome: 'REJECTED',
      reason: 'callback did not satisfy the required field contract',
      verification: 'VERIFIED',
    };
  }

  // 5. TIMESTAMP AND REPLAY WINDOW.
  if (!timestampCheck.ok) {
    await recordCallbackOutcome({
      callbackId: evidenceId,
      processingResult: 'REJECTED',
      reasonCode: 'TIMESTAMP_OUT_OF_WINDOW',
      conversionId: null,
      correlationId,
    });

    return { outcome: 'REJECTED', reason: timestampCheck.reason, verification: 'VERIFIED' };
  }

  // 5/6. IDEMPOTENCY. A repeated provider event resolves to the first
  // conversion rather than creating a second one.
  //
  // Routed through `public.get_conversion_for_event`, NOT
  // `.from('provider_conversions')`. The `app` schema is not exposed through the
  // Data API.
  //
  // This is the fast path. `record_provider_conversion` re-checks and returns the
  // same id on the slow path, so this read is an optimisation to avoid a needless
  // insert attempt rather than the thing that makes a replay safe. Law 5 is
  // enforced by the unique index underneath, not by this query.
  const { data: existingId } = await admin.rpc('get_conversion_for_event', {
    p_provider_id: providerId,
    p_provider_event_id: normalized.providerEventId,
  });

  if (existingId) {
    await recordCallbackOutcome({
      callbackId: evidenceId,
      processingResult: 'DUPLICATE',
      reasonCode: 'ALREADY_RECORDED',
      conversionId: existingId,
      correlationId,
    });

    logger.info('provider.callback_duplicate', {
      providerCode: input.providerCode,
      providerEventId: normalized.providerEventId,
    });

    return { outcome: 'DUPLICATE', conversionId: existingId };
  }

  return persistConversion({
    providerId,
    providerCode: input.providerCode,
    callbackId: evidenceId,
    normalized,
    // The wrapper normalises `lifecycle_state` to `status`.
    providerState: provider.status as ProviderState,
    correlationId,
  });
}

async function persistConversion(args: {
  providerId: string;
  providerCode: string;
  callbackId: number;
  normalized: NormalizedCallbackEvent;
  providerState: ProviderState;
  correlationId: string;
}): Promise<IngestResult> {
  const admin = createAdminClient();
  const { normalized, providerState } = args;

  // 4. IDENTIFIERS. The provider never dictates which user this is. The user is
  // resolved from OUR tracking table using an identifier WE minted, so a forged
  // callback cannot credit an account it names.
  let userId: string | null = null;

  if (normalized.trackingId) {
    // Routed through `public.resolve_tracking_user`, NOT
    // `.from('provider_participations')`. The `app` schema is not exposed through
    // the Data API.
    //
    // The wrapper returns ONLY a user id, and takes the provider id alongside the
    // tracking id. That is what makes this safe: the provider never dictates which
    // user this is. The user is resolved from OUR attribution table using an
    // identifier WE minted, so a forged callback naming somebody else's tracking
    // id resolves to nobody rather than to that other account.
    const { data: resolved } = await admin.rpc('resolve_tracking_user', {
      p_provider_id: args.providerId,
      p_tracking_id: normalized.trackingId,
    });

    userId = typeof resolved === 'string' && resolved.length > 0 ? resolved : null;
  }

  // A provider's own lifecycle decides whether this event may become a reward.
  // A SUSPENDED provider's callback is recorded and marked, never converted.
  const mayConvert = canProduceReward(providerState);

  // Routed through `app_private.record_provider_conversion`, NOT
  // `.from('provider_conversions')`. The `app` schema is not exposed through the
  // Data API.
  //
  // The command owns law 5. It returns the EXISTING conversion id when this
  // provider event has already been recorded, including when a concurrent
  // delivery wins the race, and reports which happened via p_is_duplicate. The
  // previous code caught a 23505 and then re-read the winning row from TypeScript,
  // leaving a window between the failed insert and the re-read in which the answer
  // could change underneath it.
  const { data: recordResult, error } = await admin.rpc('record_provider_conversion', {
    p_provider_id: args.providerId,
    p_provider_event_id: normalized.providerEventId,
    p_source_type: normalized.sourceType,
    p_event_type: normalized.eventType,
    p_callback_id: args.callbackId,
    p_campaign_ref: normalized.campaignRef,
    p_user_id: userId,
    p_tracking_id: normalized.trackingId,
    p_status: mayConvert ? 'VALIDATED' : 'RECEIVED',
    p_gross_value_minor: normalized.grossValueMinor ?? null,
    p_currency: normalized.currency,
    p_event_timestamp: normalized.eventTimestamp?.toISOString() ?? null,
    p_normalized_payload: normalized.normalizedPayload,
    p_correlation_id: args.correlationId,
  });

  // The command returns a single jsonb object: `{ id, isDuplicate }`.
  //
  // `isDuplicate` is what collapses the race into one call. The earlier code
  // caught a 23505 from the failed insert and then re-read the winning row, which
  // left a window in which the answer could change underneath it; the command now
  // resolves the collision itself and reports which case occurred, so this read
  // and that insert can never disagree.
  const recorded = (recordResult ?? null) as { id: string; isDuplicate: boolean } | null;
  const conversionId = recorded?.id ?? null;

  if (error || !conversionId) {
    logger.error(
      'provider.conversion_write_failed',
      errorFields(error, { providerCode: args.providerCode }),
    );

    await recordCallbackOutcome({
      callbackId: args.callbackId,
      processingResult: 'REJECTED',
      reasonCode: 'WRITE_FAILED',
      conversionId: null,
      correlationId: args.correlationId,
    });

    return { outcome: 'REJECTED', reason: 'could not record conversion', verification: 'VERIFIED' };
  }

  if (recorded?.isDuplicate) {
    // A concurrent delivery won between the fast-path read above and this insert.
    // That is the idempotency guarantee working, not a failure, and the winner's
    // conversion is the one this callback belongs to.
    await recordCallbackOutcome({
      callbackId: args.callbackId,
      processingResult: 'DUPLICATE',
      reasonCode: 'CONCURRENT_DUPLICATE',
      conversionId,
      correlationId: args.correlationId,
    });

    return { outcome: 'DUPLICATE', conversionId };
  }

  // An event with no resolvable user cannot be rewarded, whatever the provider
  // claims. It is recorded for reconciliation rather than discarded.
  if (!userId) {
    await recordCallbackOutcome({
      callbackId: args.callbackId,
      processingResult: 'IGNORED',
      reasonCode: 'UNRESOLVED_TRACKING_ID',
      conversionId,
      correlationId: args.correlationId,
    });

    logger.warn('provider.callback_unresolved_user', {
      providerCode: args.providerCode,
      providerEventId: normalized.providerEventId,
    });

    return {
      outcome: 'ACCEPTED',
      conversionId,
      eligibleForReward: false,
    };
  }

  if (!mayConvert) {
    await recordCallbackOutcome({
      callbackId: args.callbackId,
      processingResult: 'IGNORED',
      reasonCode: 'PROVIDER_NOT_LIVE',
      conversionId,
      correlationId: args.correlationId,
    });

    logger.warn('provider.callback_provider_not_live', {
      providerCode: args.providerCode,
      providerState,
    });

    return {
      outcome: 'ACCEPTED',
      conversionId,
      eligibleForReward: false,
    };
  }

  await recordCallbackOutcome({
    callbackId: args.callbackId,
    processingResult: 'ACCEPTED',
    reasonCode: null,
    conversionId,
    correlationId: args.correlationId,
  });

  logger.info('metric.provider_callback_received', {
    providerCode: args.providerCode,
    amountMinor: normalized.grossValueMinor ?? 0n,
  });

  return {
    outcome: 'ACCEPTED',
    conversionId,
    eligibleForReward: true,
  };
}
