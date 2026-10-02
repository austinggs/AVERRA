import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { canStartTask, describeRewardState, type TaskState } from '@/lib/tasks/contract';

// POST /api/tasks/[id]/start
//
// Starts an attempt at a task.
//
// The client supplies NO amount and NO reward claim. A task's reward is defined
// server-side on the task definition; the client cannot influence it (law 16, a
// reward claim matches configured economics).

const startSchema = z.object({
  deviceFingerprint: z.string().trim().max(200).optional(),
});

export const POST = route(async ({ user, body, params, correlationId }) => {
  const taskId = params.id;

  if (!taskId) {
    throw new RouteError('invalid_request', 'Unknown task.');
  }

  const parsed = startSchema.safeParse(body ?? {});
  const deviceFingerprint = parsed.success ? (parsed.data.deviceFingerprint ?? null) : null;

  const admin = createAdminClient();

  // Routed through `public.get_task`, NOT `.from('task_definitions')`. The `app`
  // schema is not exposed through the Data API.
  //
  // This is a pre-flight check only. `start_task_attempt` re-validates the task
  // state, the availability window and the attempt cap inside the transaction
  // that creates the attempt, so this read exists to produce a clearer error
  // message, not to authorise anything.
  const { data: task } = await admin.rpc('get_task', { p_task_id: taskId });

  if (!task) {
    throw new RouteError('not_found', 'Unknown task.');
  }

  const taskState = (task as Record<string, unknown>).state as TaskState;

  if (!canStartTask(taskState)) {
    throw new RouteError('conflict', 'That task is not currently available.');
  }

  const { data: attempt, error } = await admin.rpc('start_task_attempt', {
    p_user_id: user!.id,
    p_task_id: taskId,
    p_client_device_fingerprint: deviceFingerprint,
    p_client_ip: null,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    if (message.includes('attempt limit reached')) {
      throw new RouteError('conflict', 'You have used all your attempts for this task.');
    }

    if (message.includes('account is too new')) {
      throw new RouteError('forbidden', 'This task is not available on your account yet.');
    }

    if (message.includes('not available in this region')) {
      throw new RouteError('forbidden', 'This task is not available in your region.');
    }

    if (message.includes('not yet available') || message.includes('availability has ended')) {
      throw new RouteError('conflict', 'That task is outside its availability window.');
    }

    console.error('[api] start task failed', { correlationId, error: error.message });
    throw new RouteError('internal_error', 'Could not start that task.');
  }

  const created = Array.isArray(attempt) ? attempt[0] : attempt;

  // Doc 40 SIGNAL COLLECTION. Runs the detectors for this user and appends any
  // observations.
  //
  // DELIBERATELY NON-BLOCKING AND IGNORED ON ERROR.
  //
  // A signal is an OBSERVATION, not a verdict. Failing the user's request
  // because a detector tripped would give detection the power of enforcement,
  // which is exactly the separation doc 40 and law 42 depend on. Losing an
  // observation is recoverable; refusing a legitimate user is not.
  // `rpc()` returns a PostgrestFilterBuilder, not a promise, so it must be
  // awaited before it has a `.catch`. The whole call is wrapped so a detector
  // error can never surface to the user.
  void (async () => {
    try {
      await admin.rpc('record_task_signal', {
        p_user_id: user!.id,
        p_device_fingerprint: deviceFingerprint,
        p_client_ip: null,
        p_correlation_id: correlationId,
      });
    } catch (detectionError) {
      // Intentionally swallowed. The attempt succeeded; detection is
      // best-effort and must never degrade the user-facing path.
      console.error('[api] risk signal collection failed', {
        correlationId,
        error: detectionError,
      });
    }
  })();

  return NextResponse.json(
    {
      attempt: {
        id: created?.id,
        taskId,
        taskCode: task.code,
        status: created?.status,
        startedAt: created?.started_at,
        expiresAt: created?.expires_at,
        attemptNumber: created?.attempt_number,
      },
      // Doc 09 TRANSPARENCY: starting an attempt pays nothing.
      message:
        'Task started. Completing it will not credit a reward until the result has been verified.',
    },
    { status: 201 },
  );
});

// GET /api/tasks/[id]
//
// The attempt history for the caller on one task, with honest state wording.
export const GET = route(async ({ user, params }) => {
  const taskId = params.id;

  if (!taskId) {
    throw new RouteError('invalid_request', 'Unknown task.');
  }

  const admin = createAdminClient();

  // Routed through `public.list_my_task_attempts`, NOT `.from('task_attempts')`.
  // The `app` schema is not exposed through the Data API. The `user_id` scoping
  // and the `task_id` filter both happen in the database.
  const { data, error } = await admin.rpc('list_my_task_attempts', {
    p_user_id: user!.id,
    p_task_id: taskId,
  });

  if (error) {
    throw new RouteError('internal_error', 'Could not read your attempts.');
  }

  const attempts = (data ?? []) as Array<{
    id: string;
    status: string;
    rewardId: string | null;
    rejectionReason: string | null;
    reviewReason: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
  }>;

  return NextResponse.json({
    attempts: attempts.map((row) => ({
      id: row.id,
      status: row.status,
      ...describeRewardState({ status: row.status as never, hasReward: Boolean(row.rewardId) }),
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
      verifiedAt: row.verifiedAt,
      reviewReason: row.reviewReason,
      rejectionReason: row.rejectionReason,
    })),
  });
});
