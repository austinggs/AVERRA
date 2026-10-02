import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DepositStatus } from '@/lib/contracts/states';
import { buildDepositTimeline } from '@/lib/deposits/timeline';

// GET /api/deposits/:id
//
// The status timeline the UI renders (doc 10 FINANCIAL STATES). Each state has a
// distinct meaning and distinct user-facing wording, because "sent", "detected"
// and "credited" are NOT the same thing (doc 09 TRANSPARENCY).

const STATUS_COPY: Record<string, string> = {
  PENDING: 'Waiting for you to send the payment.',
  SUBMITTED: 'Transaction hash received. Verification has not completed.',
  VERIFIED: 'Settlement verified. Awaiting authorised confirmation.',
  CONFIRMED: 'Credited to your User Funding Balance.',
  NEEDS_REVIEW: 'A human needs to review this deposit.',
  REJECTED: 'This deposit was rejected and was not credited.',
  EXPIRED: 'This request expired before payment was received.',
  CANCELLED: 'This request was cancelled.',
};

export const GET = route(async ({ user, params }) => {
  const depositId = params.id;

  if (!depositId) {
    throw new RouteError('invalid_request', 'Unknown deposit reference.');
  }

  const admin = createAdminClient();

  // Routed through `public.get_my_deposit`, NOT `.from('deposit_requests')`.
  // The `app` schema is not exposed through the Data API.
  //
  // The wrapper takes BOTH the deposit id and the caller's id and returns NULL
  // when they do not match, so "not yours" and "not there" are indistinguishable
  // here exactly as they were in the previous explicit check.
  const { data, error } = await admin.rpc('get_my_deposit', {
    p_user_id: user!.id,
    p_deposit_id: depositId,
  });

  if (error) {
    throw new RouteError('internal_error', 'Could not read that deposit request.');
  }

  if (!data) {
    throw new RouteError('not_found', 'Unknown deposit reference.');
  }

  const row = data as Record<string, unknown>;
  const status = row.status as DepositStatus;

  return NextResponse.json({
    deposit: {
      id: row.id as string,
      reference: row.reference as string,
      status,
      statusMessage: STATUS_COPY[status] ?? 'Status unavailable.',
      // Only CONFIRMED is a credited state. Everything else is not.
      credited: status === 'CONFIRMED',
      symbol: row.declaredAsset as string | null,
      declaredAmountMinor: row.declaredAmountMinor as string | null,
      unit: row.declaredUnit as string | null,
      verifiedAmountMinor: row.verifiedAmountMinor as string | null,
      chainId: row.chainId as number,
      requestedAt: row.requestedAt as string,
      expiresAt: row.expiresAt as string,
      submittedAt: row.submittedAt as string | null,
      verifiedAt: row.verifiedAt as string | null,
      confirmedAt: row.confirmedAt as string | null,
      reviewReason: row.reviewReason as string | null,
      rejectionReason: row.rejectionReason as string | null,
    },

    // Derived from the timestamps the wrapper returned, not read from
    // app.deposit_events, which is not reachable through the Data API.
    timeline: buildDepositTimeline(
      {
        requestedAt: row.requestedAt as string,
        submittedAt: row.submittedAt as string | null,
        verifiedAt: row.verifiedAt as string | null,
        confirmedAt: row.confirmedAt as string | null,
      },
      status,
    ),
  });
});
