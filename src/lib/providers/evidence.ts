import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/observability/logger';
import type { ProviderAdapter, RawCallback } from '@/lib/providers/types';
import { errorFields } from '@/lib/observability/errors';

// Raw evidence capture for provider callbacks (doc 08: "record raw evidence").
//
// The rule that shapes this module: the raw payload is written BEFORE any
// processing verdict is acted on. A rejected callback must still be auditable,
// because "what did the provider actually send" is the first question anyone asks
// when a payout dispute appears. Provider callbacks are APPEND-ONLY in the
// database, so nothing here may update a row it has written.

export type EvidenceInput = {
  providerId: string;
  rawBody: string;
  parsedBody: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string | null;
  remoteAddress: string | null;
  verificationResult: string;
  verificationReason: string | null;
  algorithm: string | null;
  claimedEventId: string | null;
  claimedTimestamp: Date | null;
  correlationId: string;
};

export function hashPayload(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Writes raw callback evidence. Returns the callback id, or null on failure.
 *
 * A failure here is logged as an error rather than swallowed: losing evidence is
 * a serious operational problem, not a transient warning, and a caller that
 * cannot record what it received must not proceed to act on it.
 */
export async function recordCallbackEvidence(input: EvidenceInput): Promise<number | null> {
  const admin = createAdminClient();

  // Routed through `app_private.record_provider_callback`, NOT
  // `.from('provider_callbacks')`. The `app` schema is not exposed through the
  // Data API, so this insert could never have succeeded and NO provider callback
  // evidence was ever actually persisted.
  //
  // The row is append-only by trigger. There is no update or delete path, by
  // design: what a provider sent us is a fact about the past, and a later
  // correction is a new row rather than an edit to this one.
  const { data, error } = await admin.rpc('record_provider_callback', {
    p_provider_id: input.providerId,
    p_remote_address: input.remoteAddress,
    p_signature_present: input.signature !== null,
    p_signature_algorithm: input.algorithm,
    p_verification_result: input.verificationResult,
    p_verification_reason: input.verificationReason,
    p_claimed_event_id: input.claimedEventId,
    p_claimed_event_timestamp: input.claimedTimestamp?.toISOString() ?? null,
    p_raw_payload: input.parsedBody,
    p_payload_hash: hashPayload(input.rawBody),
    p_headers: input.headers,
    p_correlation_id: input.correlationId,
  });

  if (error || data === null || data === undefined) {
    logger.error(
      'provider.callback_evidence_write_failed',
      errorFields(error, { providerId: input.providerId }),
    );
    return null;
  }

  // The command returns the identity row's id as a scalar, which PostgREST
  // delivers as a bare value rather than an object.
  return Number(data);
}

/**
 * Records what became of a callback.
 *
 * Kept in its own table rather than as an UPDATE on the evidence row, so the
 * evidence stays append-only and the outcome is independently auditable.
 */
export async function recordCallbackOutcome(args: {
  callbackId: number;
  processingResult: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE' | 'IGNORED' | 'PENDING';
  reasonCode: string | null;
  conversionId: string | null;
  correlationId?: string;
}): Promise<void> {
  const admin = createAdminClient();

  // Routed through `app_private.record_callback_outcome`, NOT
  // `.from('provider_callback_results')`. The `app` schema is not exposed through
  // the Data API.
  //
  // The command is idempotent on callback_id, so a retried worker cannot record
  // two different verdicts about the same callback. The previous insert would
  // have collided on the same primary key and logged an error every time, which
  // is noise rather than information.
  const { error } = await admin.rpc('record_callback_outcome', {
    p_callback_id: args.callbackId,
    p_processing_result: args.processingResult,
    p_reason_code: args.reasonCode,
    p_conversion_id: args.conversionId,
    p_correlation_id: args.correlationId ?? null,
  });

  if (error) {
    logger.error(
      'provider.callback_outcome_write_failed',
      errorFields(error, { callbackId: args.callbackId }),
    );
  }
}

/** Builds the adapter-facing raw callback shape from a live request. */
export function toRawCallback(args: {
  providerCode: string;
  rawBody: string;
  parsedBody: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string | null;
  remoteAddress: string | null;
}): RawCallback {
  return {
    providerCode: args.providerCode,
    body: args.parsedBody,
    rawBody: args.rawBody,
    headers: args.headers,
    receivedAt: new Date(),
    remoteAddress: args.remoteAddress,
    signature: args.signature,
  };
}

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Applies a recorded provider reversal.
 *
 * This is the ONLY caller of `apply_provider_reversal`, and the reason it lives here
 * rather than inline in `ingest.ts` is that a reversal moves money. The command
 * resolves which conversion the vendor withdrew, refuses a row that is not a reversal,
 * and routes through `reverse_reward` so the original keeps its history (law 7).
 *
 * WHY THE ERROR IS RETURNED RATHER THAN THROWN
 *
 * The callback route answers every provider callback with a uniform 200, so a throw
 * here would be swallowed and the withdrawal would be lost with nothing recorded -
 * which is the exact silent-discard defect migration 057 exists to prevent. Returning
 * the error lets `ingest.ts` record `REVERSAL_APPLY_FAILED` against the callback, which
 * makes the failure visible and retryable from the audit trail.
 *
 * `no_reward` is a SUCCESS outcome, not an error: the conversion existed and was never
 * converted into money, so there is nothing to claw back. While no provider is LIVE
 * that is the only possible outcome.
 */
export async function applyProviderReversal(args: {
  reversalConversionId: string;
  correlationId: string;
  reasonCode?: string;
  actorId?: string | null;
}): Promise<{
  outcome: {
    outcome: 'reversed' | 'no_reward';
    originalId?: string;
    alreadyReversed?: boolean;
  } | null;
  error: { message: string } | null;
}> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('apply_provider_reversal', {
    p_reversal_conversion_id: args.reversalConversionId,
    // The provider's own words, carried into the audit trail verbatim.
    p_reason_code: args.reasonCode ?? 'provider reported the transaction as reversed',
    p_actor_id: args.actorId ?? null,
    p_correlation_id: args.correlationId,
  });

  if (error) {
    return { outcome: null, error: { message: error.message } };
  }

  return {
    outcome: (data ?? null) as {
      outcome: 'reversed' | 'no_reward';
      originalId?: string;
      alreadyReversed?: boolean;
    } | null,
    error: null,
  };
}
