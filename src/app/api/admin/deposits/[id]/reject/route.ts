import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/admin/deposits/:id/reject
//
// Rejection creates NO credit and is terminal. A reason is mandatory, because a
// rejection without a reason is unauditable and unexplainable to the user
// (doc 57 AUDIT LOGGING).
//
// A CONFIRMED deposit can never be rejected here. Correcting an existing credit
// requires a compensating ledger entry through a separate authorised process, so
// that history is never rewritten (law 15, doc 36 REVERSALS).

const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required.').max(500),
});

export const POST = route(
  async ({ user, body, params, correlationId }) => {
    const depositId = params.id;

    if (!depositId) {
      throw new RouteError('invalid_request', 'Unknown deposit reference.');
    }

    const parsed = rejectSchema.safeParse(body);

    if (!parsed.success) {
      throw new RouteError(
        'validation_failed',
        'A reason is required to reject a deposit.',
        parsed.error.flatten().fieldErrors,
      );
    }

    const admin = createAdminClient();

    const { data: rejected, error } = await admin.rpc('reject_deposit', {
      p_deposit_id: depositId,
      p_actor_id: user!.id,
      p_reason: parsed.data.reason,
      p_correlation_id: correlationId,
    });

    if (error) {
      const message = error.message;

      if (message.includes('already terminal')) {
        throw new RouteError('conflict', 'That deposit has already been finalised.');
      }

      console.error('[api] reject deposit failed', { correlationId, error: error.message });
      throw new RouteError('internal_error', 'Could not reject that deposit.');
    }

    const deposit = Array.isArray(rejected) ? rejected[0] : rejected;

    return NextResponse.json({
      deposit: {
        id: deposit?.id,
        status: deposit?.status,
        rejectionReason: deposit?.rejection_reason,
      },
      message: 'Deposit rejected. No funding was credited.',
    });
  },
  { capability: 'deposit.approve' },
);
