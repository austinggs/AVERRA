import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  describeRewardState,
  canTaskPay,
  type VerificationMechanism,
  type TaskAttemptStatus,
} from '@/lib/tasks/contract';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';

export const metadata = { title: 'Tasks - Averra' };

// The task list (doc 12).
//
// The page states each task's verification mechanism and repeats that a claim is
// not a payment. Doc 09 TRANSPARACY: "sent", "detected" and "verified" are not
// "credited", and the user must be able to see that BEFORE attempting.

const MECHANISM_COPY: Record<VerificationMechanism, string> = {
  SERVER_EVENT: 'Verified by an automatic server-side event.',
  SERVER_RULE: 'Verified by a server-side rule.',
  SELF_ATTESTED: 'You submit the completion, and a person reviews it.',
  NONE: 'This task does not pay a reward.',
};

// A self-attested task is called out in a warmer tone, because its reward depends
// on a person reviewing it. The user should not have to read the fine print to
// learn that.
const MECHANISM_PILL: Record<VerificationMechanism, 'brand' | 'neutral' | 'warning'> = {
  SERVER_EVENT: 'brand',
  SERVER_RULE: 'brand',
  SELF_ATTESTED: 'warning',
  NONE: 'neutral',
};

export default async function TasksPage() {
  const user = await requireUser();
  const admin = createAdminClient();

  // Routed through `public.list_live_tasks` and `public.list_my_task_attempts`,
  // NOT `.from('task_definitions')`. The `app` schema is not exposed through the
  // Data API, so a PostgREST read of it fails with PGRST205.
  const [{ data: tasks }, { data: attempts }] = await Promise.all([
    admin.rpc('list_live_tasks'),
    admin.rpc('list_my_task_attempts', { p_user_id: user.id }),
  ]);

  const rows = (tasks ?? []) as Array<Record<string, unknown>>;

  const items = rows.map((task) => {
    const id = task.id as string;
    const amount = (task.rewardAmountMinor as string | null) ?? null;
    const mechanism = task.verificationMechanism as VerificationMechanism;
    const mine = ((attempts ?? []) as Array<Record<string, unknown>>).filter(
      (attempt) => attempt.taskId === id,
    );

    return {
      id,
      code: task.code as string,
      title: task.title as string,
      description: (task.description as string | null) ?? null,
      instructions: (task.instructions as string | null) ?? null,
      amount,
      unit: (task.rewardUnit as string | null) ?? null,
      mechanism,
      minDurationSeconds: (task.minDurationSeconds as number | null) ?? null,
      attempts: mine.map((attempt) => ({
        id: attempt.id as string,
        status: attempt.status as TaskAttemptStatus,
        hasReward: Boolean(attempt.rewardId),
        rejectionReason: (attempt.rejectionReason as string | null) ?? null,
      })),
    };
  });

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Completing a task does not pay immediately. A reward is credited only after the completion has been verified."
      />

      {!tasks || tasks.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No tasks available right now"
            description="Offers and surveys from approved providers appear under Earn."
            action={
              <ButtonLink href="/earn" size="sm">
                Go to Earn
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((task) => {
            const { amount, mechanism, unit, minDurationSeconds, attempts: mine } = task;
            const pays = canTaskPay({
              rewardAmountMinor: amount === null ? null : BigInt(amount),
              verificationMechanism: mechanism,
            });

            return (
              <li key={task.id}>
                <Card>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight text-ink-900">
                        {task.title}
                      </h2>
                      {task.description ? (
                        <p className="mt-1 text-sm leading-relaxed text-ink-500">
                          {task.description}
                        </p>
                      ) : null}
                    </div>

                    {pays && amount ? (
                      <p className="shrink-0 text-right">
                        <span className="block text-lg font-bold tabular-nums tracking-tight text-ink-900">
                          {BigInt(amount).toString(10)}
                        </span>
                        <span className="text-xs text-ink-500">{unit}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone={MECHANISM_PILL[mechanism]}>
                      {mechanism === 'SELF_ATTESTED' ? 'Human reviewed' : 'Server verified'}
                    </Pill>
                    {minDurationSeconds ? <Pill>At least {minDurationSeconds}s</Pill> : null}
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-ink-500">
                    {MECHANISM_COPY[mechanism]}
                  </p>

                  {mine.length > 0 ? (
                    <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
                      {mine.map((attempt) => {
                        const described = describeRewardState({
                          status: attempt.status,
                          hasReward: attempt.hasReward,
                        });

                        return (
                          <li key={attempt.id} className="text-xs text-ink-500">
                            {described.label}
                            {attempt.rejectionReason ? ` (${attempt.rejectionReason})` : ''}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  <div className="mt-4">
                    <ButtonLink href={`/tasks/${task.id}`} size="sm" variant="secondary">
                      View task
                    </ButtonLink>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card tone="sunken" className="mt-8">
        <p className="text-sm leading-relaxed text-ink-500">
          Task rewards are configured by Averra. A task that declares no verification mechanism can
          never pay a reward, and a completion you submit is evidence rather than a payment.
        </p>
      </Card>
    </div>
  );
}
