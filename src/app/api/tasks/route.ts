import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  canStartTask,
  canTaskPay,
  type TaskState,
  type VerificationMechanism,
} from '@/lib/tasks/contract';

// GET /api/tasks
//
// The task catalogue. Only LIVE, currently-available tasks are returned.
//
// Doc 13 PRESENTATION: each entry states its verification mechanism and that a
// claim is not a payment, so a user can see why a task might not pay BEFORE
// attempting it rather than discovering it afterwards.
export const GET = route(async ({ searchParams }) => {
  // `list_live_tasks` takes no parameters: the `state = 'LIVE'` filter and the
  // 50-row cap are both enforced in the database, so a caller cannot widen the
  // read by asking. `limit` therefore slices what the wrapper returned, and
  // cannot raise the wrapper's own ceiling.
  const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);

  const admin = createAdminClient();

  // Routed through `public.list_live_tasks`, NOT `.from('task_definitions')`.
  // The `app` schema is not exposed through the Data API, and the wrapper does
  // the `state = 'LIVE'` filter in the database.
  const { data, error } = await admin.rpc('list_live_tasks');

  if (error) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not read the task list.' } },
      { status: 500 },
    );
  }

  const now = Date.now();

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const tasks = rows
    // Availability is configuration-driven (doc 12), so a task outside its window
    // is not offered even when its state is LIVE.
    .filter((task: Record<string, unknown>) => {
      const from = task.availableFrom as string | null;
      const until = task.availableUntil as string | null;
      if (from && new Date(from).getTime() > now) return false;
      if (until && new Date(until).getTime() < now) return false;
      return true;
    })
    .map((task: Record<string, unknown>) => {
      const amount = (task.rewardAmountMinor as string | null) ?? null;
      const mechanism = task.verificationMechanism as VerificationMechanism;

      return {
        id: task.id as string,
        code: task.code as string,
        title: task.title as string,
        description: task.description as string | null,
        instructions: task.instructions as string | null,
        startable: canStartTask(task.state as TaskState),

        verificationMechanism: mechanism,
        // Mirrors the database constraints so the UI can be honest up front.
        paysReward: canTaskPay({
          rewardAmountMinor: amount === null ? null : BigInt(amount),
          verificationMechanism: mechanism,
        }),
        rewardAmountMinor: amount,
        rewardUnit: task.rewardUnit,

        minDurationSeconds: task.minDurationSeconds,
        maxAttemptsPerUser: task.maxAttemptsPerUser,
        availableFrom: task.availableFrom,
        availableUntil: task.availableUntil,

        disclosure:
          'Submitting a completion does not pay a reward. A reward is credited only after the completion has been verified.',
      };
    });

  // `count` stays the length of the array actually returned. Reporting a total
  // that the payload does not contain would tell a client to paginate past data
  // it can never reach.
  const page = tasks.slice(0, limit);

  return NextResponse.json({ tasks: page, count: page.length });
});
