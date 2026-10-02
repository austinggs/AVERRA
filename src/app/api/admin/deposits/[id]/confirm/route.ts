import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/admin/deposits/:id/confirm
//
// The authoritative funding credit. Requires the deposit.approve capability.
//
// The capability check happens in the route wrapper BEFORE this handler runs.
// The database then enforces the second, independent control: the requester can
// never approve their own deposit (law 55). Two controls, because a capability
// alone cannot express "and not by the person who requested it".
//
// The client cannot reach this path: it is not exposed to the browser client, the
// function is revoked from anon and authenticated, and the actor identity comes
// from the verified JWT, never from the request body.

const confirmSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(
  async ({ user, body, params, correlationId }) => {
    const depositId = params.id;

    if (!depositId) {
      throw new RouteError('invalid_request', 'Unknown deposit reference.');
    }

    const parsed = confirmSchema.safeParse(body ?? {});

    if (!parsed.success) {
      throw new RouteError('validation_failed', 'The confirmation request was malformed.');
    }

    const idempotencyKey = deriveIdempotencyKey({
      actorId: user!.id,
      scope: 'deposit.confirm',
      provided: parsed.data.idempotencyKey ?? depositId,
      payload: { depositId },
    });

    const admin = createAdminClient();

    const { data: confirmed, error } = await admin.rpc('confirm_deposit', {
      p_deposit_id: depositId,
      p_approver_id: user!.id,
      p_idempotency_key: idempotencyKey,
      p_reason: parsed.data.reason ?? null,
      p_correlation_id: correlationId,
    });

    if (error) {
      const message = error.message;

      if (message.includes('cannot approve their own deposit')) {
        throw new RouteError(
          'forbidden',
          'A deposit cannot be approved by the person who requested it.',
        );
      }

      if (message.includes('must be VERIFIED first')) {
        throw new RouteError(
          'needs_review',
          'This deposit has not passed verification. Route it to review instead.',
        );
      }

      if (message.includes('reason is required')) {
        throw new RouteError(
          'validation_failed',
          'A reason is required to confirm a deposit that is in review.',
        );
      }

      console.error('[api] confirm deposit failed', { correlationId, error: error.message });
      throw new RouteError('internal_error', 'Could not confirm that deposit.');
    }

    const deposit = Array.isArray(confirmed) ? confirmed[0] : confirmed;

    return NextResponse.json({
      deposit: {
        id: deposit?.id,
        status: deposit?.status,
        creditedAmountMinor: deposit?.verified_amount_minor,
        unit: deposit?.declared_unit,
        confirmedAt: deposit?.admin_confirmed_at,
        confirmedBy: user!.id,
      },
      message: 'Deposit confirmed and credited to the User Funding Balance.',
    });
  },
  { capability: 'deposit.approve' },
);
