'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, Pill } from '@/components/ui/Card';

// Start and claim a task attempt.
//
// THIS COMPONENT CANNOT PAY ANYTHING, AND IS NOT TRYING TO.
//
// It posts a start request and a claim request. A claim is evidence (doc 12
// VERIFICATION). The reward is created by the database inside
// `verify_task_completion`, which this component never calls. There is no code
// path here that mutates a balance, and no optimistic balance update to undo.

type Phase = 'idle' | 'starting' | 'started' | 'claiming' | 'claimed' | 'error';

interface StartResponse {
  attempt?: { id: string; status: string; startedAt: string; expiresAt: string | null };
  message?: string;
  error?: { code: string; message: string };
}

interface SubmitResponse {
  attempt?: { id: string; status: string; label: string };
  message?: string;
  error?: { code: string; message: string };
}

export function TaskActions({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function start() {
    setPhase('starting');
    setMessage(null);

    const res = await fetch(`/api/tasks/${taskId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const body = (await res.json()) as StartResponse;

    if (!res.ok || body.error) {
      setPhase('error');
      setMessage(body.error?.message ?? 'Could not start that task.');
      return;
    }

    setAttemptId(body.attempt?.id ?? null);
    setPhase('started');
    setMessage(body.message ?? 'Task started.');
    startTransition(() => router.refresh());
  }

  async function claim() {
    if (!attemptId) return;

    setPhase('claiming');
    setMessage(null);

    const res = await fetch(`/api/tasks/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Whatever the user observed. Stored as evidence and never read to decide
      // a payout: the impossible-time check uses the server's own measurement.
      body: JSON.stringify({ claim: { submittedFrom: 'task_detail' } }),
    });

    const body = (await res.json()) as SubmitResponse;

    if (!res.ok || body.error) {
      setPhase('error');
      setMessage(body.error?.message ?? 'Could not record your completion.');
      return;
    }

    setPhase('claimed');
    setMessage(body.message ?? 'Completion recorded.');
    startTransition(() => router.refresh());
  }

  const busy = phase === 'starting' || phase === 'claiming' || pending;

  if (phase === 'claimed') {
    return (
      <Card tone="sunken">
        <Pill>Submitted</Pill>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{message}</p>
      </Card>
    );
  }

  return (
    <div>
      {/* Keyed on `attemptId`, not on `phase`. While a claim is in flight the
          phase is 'claiming', and branching on phase here would swap the button
          back to "Start task" mid-request. */}
      {attemptId ? (
        <Button onClick={claim} disabled={busy} className="w-full sm:w-auto">
          {phase === 'claiming' ? 'Recording…' : 'I have completed this'}
        </Button>
      ) : (
        <Button onClick={start} disabled={busy || disabled} className="w-full sm:w-auto">
          {phase === 'starting' ? 'Starting…' : 'Start task'}
        </Button>
      )}

      {message ? (
        <p role="status" className="mt-3 text-xs leading-relaxed text-ink-500">
          {message}
        </p>
      ) : null}
    </div>
  );
}
