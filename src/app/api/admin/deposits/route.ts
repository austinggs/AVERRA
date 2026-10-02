import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/admin/deposits
//
// The deposit review queue (doc 43 DEPOSIT REVIEW WORKFLOW, doc 87 dashboard).
// Requires deposit.view.
//
// Rows are read with the service role because RLS grants no browser access to
// this table. The capability check in the wrapper is what authorises the read,
// and it is re-evaluated on every request rather than cached in the UI.

// The states an operator can act on. This mirrors, it does not decide: the
// database holds the authoritative queue definition inside
// `list_deposits_awaiting_review`. The constant exists here so an unrecognised
// `?status=` is rejected as a bad request rather than silently returning the
// whole queue, which would look to an operator like "nothing is filtered".
const QUEUE_STATES = ['SUBMITTED', 'VERIFIED', 'NEEDS_REVIEW'] as const;

export const GET = route(
  async ({ searchParams }) => {
    const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);
    const statusParam = searchParams.get('status');

    const admin = createAdminClient();

    if (statusParam && !QUEUE_STATES.includes(statusParam as (typeof QUEUE_STATES)[number])) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: `Unknown status. Expected one of: ${QUEUE_STATES.join(', ')}.`,
          },
        },
        { status: 400 },
      );
    }

    // Routed through `public.list_deposits_awaiting_review`, NOT
    // `.from('deposit_requests')`. The `app` schema is not exposed through the
    // Data API.
    //
    // The wrapper already restricts the queue to QUEUE_STATES in the database, so
    // the states this route cares about cannot be widened by a caller. `limit`
    // and the status filter are applied here, over what the wrapper returned.
    const { data, error } = await admin.rpc('list_deposits_awaiting_review');

    if (error) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Could not read the deposit queue.' } },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const queue = rows
      .filter((row) => (statusParam ? row.status === statusParam : true))
      .slice(0, limit);

    return NextResponse.json({
      deposits: queue.map((row) => ({
        id: row.id as string,
        userId: row.userId as string,
        status: row.status as string,
        reference: row.reference as string,
        chainId: row.chainId as string | null,
        symbol: row.declaredAsset as string,
        declaredAmountMinor: row.declaredAmountMinor as string | null,
        unit: row.declaredUnit as string,
        txHash: row.txHash as string | null,
        transferLogIndex: row.transferLogIndex as number | null,
        verifiedAmountMinor: row.verifiedAmountMinor as string | null,
        verificationStatus: row.verificationStatus as string | null,
        reviewReason: row.reviewReason as string | null,
        requiredApprovals: row.requiredApprovals as number | null,
        requestedAt: row.requestedAt as string,
        expiresAt: row.expiresAt as string | null,
        submittedAt: row.submittedAt as string | null,
        confirmedAt: row.confirmedAt as string | null,
        // Surfaced so the operator can see whether a second approver is needed.
        needsSecondApprover: ((row.requiredApprovals as number | null) ?? 1) > 1,
      })),
      count: queue.length,
    });
  },
  { capability: 'deposit.view' },
);
