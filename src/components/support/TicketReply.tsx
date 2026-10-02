'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

// Adds a user message to an existing ticket.
//
// The user writes their own text. There is no generated or suggested reply here,
// and the agent-reply path is server-only (law 58: an AI or automated system
// never authors a support reply). This component only posts what was typed.

export function TicketReply({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPhase('sending');
          setMessage(null);

          const res = await fetch(`/api/support/tickets/${ticketId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body }),
          });

          const payload = (await res.json()) as { error?: { message: string } };

          if (!res.ok || payload.error) {
            setPhase('error');
            setMessage(payload.error?.message ?? 'Could not send your reply.');
            return;
          }

          setBody('');
          setPhase('idle');
          router.refresh();
        }}
        className="space-y-3"
      >
        <label htmlFor="reply" className="text-xs font-medium text-ink-500">
          Add a reply
        </label>
        <textarea
          id="reply"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={2}
          maxLength={5000}
          rows={4}
          placeholder="Write your message here. A human agent will read it."
          className="min-h-24 w-full rounded-tile border border-ink-200 bg-surface px-3 py-2.5 text-sm"
        />

        {message ? (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={phase === 'sending' || body.trim().length < 2}>
          {phase === 'sending' ? 'Sending…' : 'Send reply'}
        </Button>
      </form>
    </Card>
  );
}
