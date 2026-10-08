import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/observability/logger';
import { errorFields } from '@/lib/observability/errors';
import {
  canProduceReward,
  type NormalizedCallbackEvent,
  type ProviderAdapter,
  type ProviderState,
} from '@/lib/providers/types';
import { checkTimestamp } from '@/lib/providers/normalize';
import { getAdapter } from '@/lib/providers/registry';
import {
  applyProviderReversal,
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
 * THE FIELD NAMES COME FROM THE ADAPTER, NOT FROM HERE.
 *
 * This function used to contain the literal list `['event_id', 'trans_id']`. `trans_id`
 * is CPX Research's transaction-id placeholder, so one vendor's wire format was
 * compiled into the shared ingestion path that every provider flows through - the
 * coupling law 12 exists to prevent. `ingest.ts` is provider-agnostic code and a
 * vendor-specific string had no business in it.
 *
 * WHY IT MATTERED RATHER THAN BEING COSMETIC: on the live postback of 2026-10-04 a
 * signature-VERIFIED CPX callback produced a null `claimed_event_id`, because CPX never
 * sends `event_id`. Reconciling a payout dispute then meant hand-searching
 * `raw_payload`. Nothing threw; the column was simply empty.
 *
 * The adapter declares its own aliases via `claimedEventIdFields`. An adapter that
 * omits it contributes no names, and the column is recorded null - a valid outcome,
 * because a shared default of `['event_id']` would reintroduce precisely the guess
 * being removed.
 *
 * RECORDED AS EVIDENCE ONLY. Nothing downstream trusts this to identify a paying user;
 * the reward path resolves identity from our own tracking table (law 5).
 */
function readClaimedEventId(
  body: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = body[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
}

/**
 * The field aliases this provider's adapter declares, or an empty list.
 *
 * Empty is the honest default for an adapter that does not declare any: it means
 * "this provider names its event id in a way we have not documented", and the column
 * is recorded null rather than being populated from a guess that belongs to a
 * different vendor.
 *
 * Wrapped in try/catch because `claimedEventIdFields` is adapter-supplied code and
 * this runs on the REJECTED path too, where a throw would replace a clean rejection
 * with a 500 and lose the evidence write. Evidence collection must never fail because
 * an optional field-naming hint misbehaved.
 */
function claimedEventIdFieldsFor(adapter: ProviderAdapter): readonly string[] {
  try {
    return adapter.claimedEventIdFields?.() ?? [];
  } catch {
    return [];
  }
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
      claimedEventId: readClaimedEventId(input.parsedBody, claimedEventIdFieldsFor(adapter)),
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
    claimedEventId: normalized
        ? normalized.providerEventId
        : readClaimedEventId(input.parsedBody, claimedEventIdFieldsFor(adapter)),
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
    // Routed through `public.resolve_tracking_user_for_attribution`, NOT
    // `.from('provider_participations')`. The `app` schema is not exposed through
    // the Data API.
    //
    // The LIVENESS-AWARE wrapper (migration 060), not migration 034's
    // `resolve_tracking_user`: the old one has no status filter and resolves ANY
    // participation row, live or dead, so a late or replayed callback naming a
    // finished participation would still attribute to that user. The new one
    // resolves only while the participation is STARTED or QUALIFIED and returns
    // nobody otherwise - which the pipeline below records as
    // UNRESOLVED_TRACKING_ID rather than discarding (see Q-45).
    //
    // What this does NOT promise: a forged callback naming a VALID, LIVE tracking
    // id of another user still resolves to them, under either wrapper.
    // Unpredictability narrows that window; the settlement gate is what stops
    // money leaving.
    const { data: resolved } = await admin.rpc('resolve_tracking_user_for_attribution', {
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
  // A REVERSAL IS ACTED ON DIFFERENTLY, AND IT IS ACTED ON AT ALL.
  //
  // Before anything else: whether this event is a reversal. Both branches below depend
  // on it, and it must be computed from the ADAPTER's verdict rather than from a status
  // string compared here - the adapter already resolved the vendor's vocabulary, and
  // re-deriving it here would be the Q-43 pattern in a second place.
  const isReversal = normalized.status === 'REVERSED';

  // A REVERSAL TAKES A DIFFERENT COMMAND.
  //
  // `record_provider_reversal_conversion` rather than `record_provider_conversion` with
  // a flag. Migration 034's function is applied and its reviewed signature is left
  // alone - changing it would have broken the 14-argument positional call in
  // migration 035's public wrapper, which compiles and then fails at runtime.
  //
  // A reversal also records `matched`, which says whether an original conversion was
  // found. false is the expected outcome while no provider is LIVE, and it is reported
  // rather than treated as a failure.
  const recordArgs = isReversal
    ? {
        p_provider_id: args.providerId,
        // The suffixed id, so the unique index admits the reversal beside the original.
        p_provider_event_id: normalized.providerEventId,
        // The BARE vendor transaction id, resolved to the original row in SQL.
        p_reverses_event_id: normalized.reversesTransactionId,
        p_source_type: normalized.sourceType,
        p_event_type: normalized.eventType,
        p_callback_id: args.callbackId,
        p_campaign_ref: normalized.campaignRef,
        p_currency: normalized.currency,
        p_gross_value_minor: normalized.grossValueMinor ?? null,
        p_event_timestamp: normalized.eventTimestamp?.toISOString() ?? null,
        p_normalized_payload: normalized.normalizedPayload,
        p_correlation_id: args.correlationId,
      }
    : {
        p_provider_id: args.providerId,
        p_provider_event_id: normalized.providerEventId,
        p_source_type: normalized.sourceType,
        p_event_type: normalized.eventType,
        p_callback_id: args.callbackId,
        p_campaign_ref: normalized.campaignRef,
        p_user_id: userId,
        p_tracking_id: normalized.trackingId,
        // A REVERSAL IS RECORDED AS REVERSED, REGARDLESS OF THE PROVIDER'S STATE.
        //
        // This was a bug this change had to fix rather than carry forward. The status
        // was `mayConvert ? 'VALIDATED' : 'RECEIVED'`, which would have recorded a
        // reversal as RECEIVED - a live-looking value. Downgrading REVERSED to RECEIVED
        // would misstate what the provider said and hide that a withdrawal was offered.
        //
        // The lifecycle gate governs whether an event may become MONEY. It has no
        // business rewriting what the vendor asserted - the same reasoning that keeps a
        // SUSPENDED provider's callback recorded rather than dropped.
        p_status: mayConvert ? 'VALIDATED' : 'RECEIVED',
        p_gross_value_minor: normalized.grossValueMinor ?? null,
        p_currency: normalized.currency,
        p_event_timestamp: normalized.eventTimestamp?.toISOString() ?? null,
        p_normalized_payload: normalized.normalizedPayload,
        p_correlation_id: args.correlationId,
      };

  const { data: recordResult, error } = await admin.rpc(
    isReversal ? 'record_provider_reversal_conversion' : 'record_provider_conversion',
    recordArgs,
  );

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

  // A REVERSAL IS ACTED ON HERE, AND ONLY HERE.
  //
  // Placed BEFORE the duplicate and user-resolution branches because both of those
  // would otherwise return early and skip the clawback. A REPLAYED reversal is the
  // common case - providers re-notify, and this callback is idempotent by design - so
  // putting it after either branch would mean the second delivery did nothing.
  //
  // `apply_provider_reversal` is itself idempotent: the original is locked, and a
  // conversion already marked REVERSED returns `alreadyReversed` without moving money
  // again. Calling it unconditionally is therefore safe and is what makes the replay
  // converge on the same answer as the first delivery.
  //
  // This runs BEFORE the provider-lifecycle gate, deliberately. A SUSPENDED or
  // CANDIDATE provider pays nothing out, but it must still be able to claw back money
  // already credited while it was LIVE. Gating reversals on `canProduceReward` would
  // mean suspending a provider protects its payouts - the exact inverse of the intent.
  if (isReversal) {
    const reversal = await applyProviderReversal({
      reversalConversionId: conversionId,
      correlationId: args.correlationId,
    });

    if (reversal.error) {
      // The conversion and its evidence are already recorded, so the withdrawal is not
      // lost - it is reported as unapplied and can be retried from the audit trail.
      // Raising here would be swallowed by the route and look identical to the
      // silent-discard defect this path was written to eliminate.
      logger.error(
        'provider.reversal_apply_failed',
        errorFields(reversal.error, {
          providerCode: args.providerCode,
          conversionId,
        }),
      );

      await recordCallbackOutcome({
        callbackId: args.callbackId,
        processingResult: 'REJECTED',
        reasonCode: 'REVERSAL_APPLY_FAILED',
        conversionId,
        correlationId: args.correlationId,
      });

      return {
        outcome: 'REJECTED',
        reason: 'reversal recorded but could not be applied',
        verification: 'VERIFIED',
      };
    }

    logger.warn('provider.conversion_reversed', {
      providerCode: args.providerCode,
      conversionId,
      ...reversal.outcome,
    });

    // An unmatched reversal - the vendor withdrew a transaction we hold no conversion
    // for - is recorded and reported, not discarded. It is the expected outcome while
    // no provider is LIVE.
    await recordCallbackOutcome({
      callbackId: args.callbackId,
      processingResult: recorded?.isDuplicate ? 'DUPLICATE' : 'ACCEPTED',
      reasonCode:
        reversal.outcome?.outcome === 'reversed' ? 'REVERSAL_APPLIED' : 'REVERSAL_UNMATCHED',
      conversionId,
      correlationId: args.correlationId,
    });

    return { outcome: 'ACCEPTED', conversionId, eligibleForReward: false };
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
