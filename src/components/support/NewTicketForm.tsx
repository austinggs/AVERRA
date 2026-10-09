'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, INPUT_CLASS } from '@/components/ui/Field';

// Opens a support ticket.
//
// The user writes their own message. There is no generated text, no suggested
// reply and no summarisation: production support is 100% human, and law 58 makes
// the in-app ticket the authoritative record. This component only submits what
// the user typed.

const CATEGORIES = [
  'Deposit',
  'Withdrawal',
  'Task or reward',
  'Account',
  'Providers and surveys',
  'Other',
] as const;

export function NewTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<string>('Other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (phase === 'done') {
    return (
      <Card tone="sunken">
        <p className="text-sm font-semibold text-ink-900">Ticket created</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
          A human agent will reply to you here and in the Support Center. Nothing on Telegram can
          move money on your account.
        </p>
        <div className="mt-4">
          <Button size="sm" onClick={() => router.push('/support')}>
            Back to Support Center
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPhase('submitting');
          setMessage(null);

          const res = await fetch('/api/support/tickets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ category, subject, body }),
          });

          const payload = (await res.json()) as {
            ticket?: { id: string };
            error?: { message: string };
          };

          if (!res.ok || payload.error) {
            setPhase('error');
            setMessage(payload.error?.message ?? 'Could not create your ticket.');
            return;
          }

          setPhase('done');
          router.refresh();
        }}
        className="space-y-5"
      >
        <Field id="category" label="Category">
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={INPUT_CLASS}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field id="subject" label="Subject">
          <input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={140}
            placeholder="A short summary of the problem"
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          id="body"
          label="What happened?"
          hint="Include dates, amounts and reference numbers if you have them. Never include your password or a recovery code."
        >
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={10}
            maxLength={5000}
            rows={7}
            className={`${INPUT_CLASS} min-h-40 py-3`}
          />
        </Field>

        {message ? (
          <p role="alert" className="rounded-tile bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={phase === 'submitting'} className="w-full sm:w-auto">
          {phase === 'submitting' ? 'Submitting…' : 'Submit ticket'}
        </Button>
      </form>
    </Card>
  );
}
