import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { describeRewardState } from '@/lib/tasks/contract';

// POST /api/tasks/attempts/[attemptId]/submit
//
// Records a completion CLAIM.
//
// WHAT THIS ROUTE DOES NOT DO: it does not verify, and it does not credit. The
// database function records the claim as evidence and moves the attempt to
// SUBMITTED, after which only a server-side or human verification decision can
// produce a reward (doc 12 VERIFICATION).
//
// The client may include whatever it observed. That payload is stored as
// evidence and is never read to decide a payout.

const submitSchema = z.object({
  claim: z.record(z.string(), z.unknown()).default({}),
  // A client-reported duration is accepted ONLY as an assertion. The
  // impossible-time check uses the server's own measurement.
  claimedDurationSeconds: z.number().int().nonnegative().max(86_400).optional(),
});

export const POST = route(async ({ user, body, params, correlationId }) => {
  const attemptId = params.attemptId;

  if (!attemptId) {
    throw new RouteError('invalid_request', 'Unknown task attempt.');
  }

  const parsed = submitSchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'The claim payload was not acceptable.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  const { data: attempt, error } = await admin.rpc('submit_task_completion', {
    p_attempt_id: attemptId,
    p_user_id: user!.id,
    p_client_claim: {
      ...parsed.data.claim,
      // Stored as an assertion. Never read for the impossible-time check.
      ...(parsed.data.claimedDurationSeconds !== undefined
        ? { claimedDurationSeconds: parsed.data.claimedDurationSeconds }
        : {}),
    },
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    if (message.includes('does not belong to this user')) {
      throw new RouteError('not_found', 'Unknown task attempt.');
    }

    if (message.includes('already')) {
      throw new RouteError('conflict', 'That attempt has already been submitted.');
    }

    if (message.includes('expired')) {
      throw new RouteError('conflict', 'That attempt has expired.');
    }

    if (message.includes('impossible time')) {
      throw new RouteError('validation_failed', 'That was completed faster than this task allows.');
    }

    console.error('[api] submit task failed', { correlationId, error: error.message });
    throw new RouteError('internal_error', 'Could not record your completion.');
  }

  const updated = Array.isArray(attempt) ? attempt[0] : attempt;
  const hasReward = Boolean(updated?.reward_id);

  return NextResponse.json({
    attempt: {
      id: updated?.id,
      status: updated?.status,
      submittedAt: updated?.submitted_at,
      ...describeRewardState({ status: updated?.status as never, hasReward }),
    },
    message:
      'Completion recorded. Your claim is now awaiting verification. ' +
      'A claim is not a payment: no reward is credited until it is verified.',
  });
});
