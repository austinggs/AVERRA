import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, Pill } from '@/components/ui/Card';
import { TicketReply } from '@/components/support/TicketReply';

export const metadata = { title: 'Support ticket - Averra' };

// A single ticket and its message thread (docs 44, 85).
//
// AUTHOR KIND IS SHOWN EXPLICITLY. A user reading a thread must be able to tell
// a human agent's reply from their own message at a glance. The thread is also
// the authoritative record: it is the evidence that a human responded, so it
// cannot be summarised, translated by a machine, or edited.

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const admin = createAdminClient();

  // Routed through `public.get_my_support_ticket`, NOT `.from('support_tickets')`.
  // The `app` schema is not exposed through the Data API.
  //
  // The wrapper takes BOTH the ticket id and the caller's id and returns null when
  // they do not match. A ticket belonging to someone else therefore still reads
  // as absent rather than forbidden, but the scoping is now a property of the
  // database function instead of a filter this page could forget to apply.
  const { data: bundle } = await admin.rpc('get_my_support_ticket', {
    p_user_id: user.id,
    p_ticket_id: id,
  });

  if (!bundle) notFound();

  const { ticket, messages } = bundle as {
    ticket: {
      id: string;
      reference: string;
      subject: string;
      category: string;
      status: string;
      createdAt: string;
      firstResponseAt: string | null;
      resolvedAt: string | null;
    };
    messages: Array<{ id: string; authorKind: string; body: string; createdAt: string }>;
  };

  const status = ticket.status;
  const closed = status === 'RESOLVED' || status === 'CLOSED';
  const thread = messages;

  return (
    <div>
      <PageHeader title={ticket.subject} description={`Reference ${ticket.reference}`} />

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-ink-400">{ticket.reference}</p>
            <p className="mt-1 text-xs text-ink-500">
              {String(ticket.category)} · opened {new Date(ticket.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Pill tone={closed ? 'neutral' : 'warning'}>
            {status.replace(/_/g, ' ').toLowerCase()}
          </Pill>
        </div>

        {!ticket.firstResponseAt ? (
          <p className="mt-4 rounded-tile bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-700">
            Awaiting your first human reply. Tickets are answered by authorized human agents only.
          </p>
        ) : null}
      </Card>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-900">Conversation</h2>

        <ul className="mt-3 space-y-3">
          {thread.map((msg) => {
            const fromAgent = msg.authorKind === 'AGENT';

            return (
              <li key={msg.id}>
                <Card tone={fromAgent ? 'sunken' : 'surface'}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        fromAgent ? 'text-brand-700' : 'text-ink-700'
                      }`}
                    >
                      {fromAgent ? 'Averra support agent' : 'You'}
                    </span>
                    <span className="text-xs text-ink-400">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                    {msg.body}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Messages above are shown exactly as written. Nothing in this thread has been rewritten or
          summarised.
        </p>
      </section>

      <section className="mt-6">
        {closed ? (
          <Card tone="sunken">
            <p className="text-sm leading-relaxed text-ink-700">
              This ticket is {status.toLowerCase()} and no longer accepts replies. Open a new ticket
              if you need help with something else.
            </p>
          </Card>
        ) : (
          <TicketReply ticketId={id} />
        )}
      </section>
    </div>
  );
}
