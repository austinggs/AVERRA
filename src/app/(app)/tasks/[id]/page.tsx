import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  canStartTask,
  canTaskPay,
  describeRewardState,
  type TaskAttemptStatus,
  type TaskState,
  type VerificationMechanism,
} from '@/lib/tasks/contract';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, Pill } from '@/components/ui/Card';
import { TaskActions } from '@/components/tasks/TaskActions';

export const metadata = { title: 'Task - Averra' };

const MECHANISM_COPY: Record<VerificationMechanism, string> = {
  SERVER_EVENT: 'Verified automatically when the server observes a qualifying event.',
  SERVER_RULE: 'Verified automatically when a server-side rule confirms the conditions.',
  SELF_ATTESTED:
    'You submit the completion and a person reviews it. This cannot be approved automatically.',
  NONE: 'This task does not pay a reward, because it declares no verification mechanism.',
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const admin = createAdminClient();

  // Routed through `public.get_task`, NOT `.from('task_definitions')`. The `app`
  // schema is not exposed through the Data API.
  //
  // `get_task` is not restricted to LIVE tasks, so a paused or retired task
  // still renders here with an explanation instead of a 404. A missing id is the
  // only thing that produces a 404 now.
  const { data: task } = await admin.rpc('get_task', { p_task_id: id });

  if (!task) notFound();

  const row = task as Record<string, unknown>;

  // The task filter is applied in the database, before the wrapper's cap, so a
  // user with many attempts across many tasks still sees this task's history.
  const { data: attempts } = await admin.rpc('list_my_task_attempts', {
    p_user_id: user.id,
    p_task_id: id,
  });

  const amount = (row.rewardAmountMinor as string | null) ?? null;
  const mechanism = row.verificationMechanism as VerificationMechanism;
  const pays = canTaskPay({
    rewardAmountMinor: amount === null ? null : BigInt(amount),
    verificationMechanism: mechanism,
  });
  const startable = canStartTask(row.state as TaskState);
  const mine = (attempts ?? []) as Array<{
    id: string;
    status: string;
    rewardId: string | null;
    rejectionReason: string | null;
    reviewReason: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
  }>;

  return (
    <div>
      <PageHeader
        title={row.title as string}
        description={(row.description as string | null) ?? undefined}
      />

      <Card className="mt-6">
        {pays && amount ? (
          <div className="flex items-baseline justify-between gap-4 border-b border-ink-100 pb-4">
            <div>
              <p className="text-xs font-medium text-ink-500">Reward if verified</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-ink-900">
                {BigInt(amount).toString(10)}
                <span className="ml-1.5 text-base font-semibold text-ink-500">
                  {row.rewardUnit as string}
                </span>
              </p>
            </div>
            <Pill tone={mechanism === 'SELF_ATTESTED' ? 'warning' : 'brand'}>
              {mechanism === 'SELF_ATTESTED' ? 'Human reviewed' : 'Server verified'}
            </Pill>
          </div>
        ) : (
          <div className="border-b border-ink-100 pb-4">
            <p className="text-sm font-medium text-ink-900">This task pays no reward</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              It declares no verification mechanism, so no amount can ever be credited for it.
            </p>
          </div>
        )}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-ink-500">How it is verified</dt>
            <dd className="mt-0.5 text-sm text-ink-700">{MECHANISM_COPY[mechanism]}</dd>
          </div>
          {row.minDurationSeconds ? (
            <div>
              <dt className="text-xs font-medium text-ink-500">Minimum time</dt>
              <dd className="mt-0.5 text-sm text-ink-700">
                {row.minDurationSeconds as number} seconds, measured by the server
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium text-ink-500">Attempts allowed</dt>
            <dd className="mt-0.5 text-sm text-ink-700">{row.maxAttemptsPerUser as number}</dd>
          </div>
        </dl>

        {row.instructions ? (
          <div className="mt-4 rounded-tile bg-surface-sunken p-4">
            <h2 className="text-sm font-semibold text-ink-900">What to do</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
              {row.instructions as string}
            </p>
          </div>
        ) : null}

        <div className="mt-5">
          <TaskActions taskId={id} disabled={!startable} />
        </div>

        {!startable ? (
          <p className="mt-3 text-xs text-ink-500">
            This task is {String(row.state).toLowerCase()} and is not currently available.
          </p>
        ) : null}
      </Card>

      {mine.length > 0 ? (
        <Card className="mt-4">
          <h2 className="text-sm font-semibold text-ink-900">Your attempts</h2>
          <ul className="mt-3 space-y-2">
            {mine.map((attempt) => {
              const described = describeRewardState({
                status: attempt.status as TaskAttemptStatus,
                hasReward: Boolean(attempt.rewardId),
              });

              return (
                <li
                  key={attempt.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm text-ink-700">{described.label}</p>
                    {attempt.rejectionReason || attempt.reviewReason ? (
                      <p className="text-xs text-ink-500">
                        {attempt.rejectionReason ?? attempt.reviewReason}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-400">
                    {new Date(attempt.startedAt as string).toLocaleDateString()}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
