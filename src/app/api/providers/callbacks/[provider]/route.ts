import { NextResponse } from 'next/server';
import { ingestProviderCallback } from '@/lib/providers/ingest';
import { createAdminClient } from '@/lib/supabase/admin';
import { newCorrelationId } from '@/lib/providers/evidence';
import { logger } from '@/lib/observability/logger';

// POST /api/providers/callbacks/[provider]
//
// Provider ingress (doc 08). This is an EXTERNAL endpoint: it is called by a
// third-party server, not by a signed-in user.
//
// It is deliberately NOT wrapped in the authenticated `route()` helper, because
// a provider callback has no Averra session. Authentication here is the
// PROVIDER SIGNATURE verified inside ingestProviderCallback, not a user session.
//
// The response is intentionally uniform. A provider must not be able to
// distinguish "unknown provider" from "bad signature" from "duplicate", because
// that difference tells an attacker which part of the pipeline to attack. The
// authoritative detail lives in the audit trail.

// Provider postbacks are conventionally sent as application/x-www-form-urlencoded.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const correlationId = newCorrelationId();

  // The provider code comes from the URL, and is resolved against the registry
  // and the database. It is never trusted as an identity on its own.
  if (!/^[a-z0-9_]{2,64}$/.test(provider)) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const rawBody = await request.text();

  let parsedBody: Record<string, unknown> = {};
  let signature: string | null = null;

  try {
    if (contentType.includes('application/json')) {
      const decoded: unknown = JSON.parse(rawBody);
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        parsedBody = decoded as Record<string, unknown>;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      for (const [key, value] of params.entries()) {
        parsedBody[key] = value;
      }
    } else {
      // Unknown content type. A provider that sends something we cannot parse is
      // not a provider we can authenticate, so this is a rejection, not a guess.
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }
  } catch {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const signatureHeader = request.headers.get('x-signature');

  if (signatureHeader) {
    signature = signatureHeader;
    parsedBody.signature = parsedBody.signature ?? signatureHeader;
  }

  // A raw-body signature is computed over the exact bytes received, so the body
  // handed to the verifier is the unmodified text and not a re-serialisation.
  const remoteAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip');

  const result = await ingestProviderCallback({
    providerCode: provider,
    rawBody,
    parsedBody,
    headers: Object.fromEntries(request.headers.entries()),
    signature,
    remoteAddress,
    correlationId,
  });

  const admin = createAdminClient();

  if (result.outcome === 'ACCEPTED' && result.eligibleForReward) {
    // The conversion is now a validated business event. The REWARD is created
    // separately by the conversion-to-reward bridge, because doc 08 requires a
    // callback to produce a business event rather than to write the wallet.
    //
    // The funding source is resolved from the provider's configuration, NOT
    // from the request. A callback that named its own funding source could fund
    // itself from an unlimited promotional budget (law 10).
    // Routed through `public.get_active_provider_reward_source`, NOT
    // `.from('reward_sources')`. The `app` schema is not exposed through the
    // Data API.
    //
    // LAW 10: the funding source is resolved from the provider's configuration and
    // the URL segment this request arrived on, never from the payload. A callback
    // that named its own source could fund itself from an unlimited promotional
    // budget. The wrapper returns only the id and only for an ACTIVE source, so a
    // deactivated source cannot fund anything either.
    const { data: sourceId } = await admin.rpc('get_active_provider_reward_source', {
      p_provider_code: provider,
    });

    if (!sourceId) {
      // No configured funding source for this provider means the conversion is
      // recorded but unpaid. That is the correct outcome: a reward without a
      // traceable source must not exist at all.
      logger.warn('provider.callback_no_funding_source', {
        providerCode: provider,
        conversionId: result.conversionId,
      });
    } else {
      const { error } = await admin.rpc('apply_conversion_reward', {
        p_conversion_id: result.conversionId,
        p_source_id: sourceId,
        p_correlation_id: correlationId,
      });

      if (error) {
        // The conversion stands. A missing reward is an operational fault to be
        // retried, not a reason to un-record a verified provider event.
        logger.error('provider.apply_conversion_reward_failed', {
          conversionId: result.conversionId,
          correlationId,
          error: error.message,
        });
      }
    }
  }

  // A uniform acknowledgement. A provider retrying on a non-2xx would create
  // exactly the duplicate traffic the idempotency index exists to absorb.
  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'x-correlation-id': correlationId } },
  );
}
