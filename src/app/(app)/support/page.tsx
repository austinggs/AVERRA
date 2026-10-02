import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';

export const metadata = { title: 'Support - Averra' };

// The Support Center (docs 44 and 85). This is the AUTHORITATIVE support record
// (law 58). Telegram @vipaverra is an official human contact channel, but it
// never replaces a ticket and never authorises a financial action (law 59).

export default async function SupportPage() {
  const user = await requireUser();
  const admin = createAdminClient();

  // Routed through `public.list_my_support_tickets`, NOT
  // `.from('support_tickets')`. The `app` schema is not exposed through the Data
  // API.
  const { data, error } = await admin.rpc('list_my_support_tickets', { p_user_id: user.id });

  // A failed read is reported rather than rendered as "no tickets", because
  // those two states are very different to the person looking at this page.
  const tickets = error
    ? null
    : ((data ?? []) as Array<{
        id: string;
        reference: string;
        subject: string;
        category: string;
        status: string;
        createdAt: string;
        firstResponseAt: string | null;
      }>);

  if (error) {
    console.error('[support] ticket list failed', errorFields(error));
  }

  return (
    <div>
      <PageHeader
        title="Support Center"
        description="Averra support is 100% human-operated. Only authorized human agents write replies. No automated system or AI writes a support reply."
      />

      <Card tone="sunken" className="mt-4">
        <p className="text-sm leading-relaxed text-ink-700">
          You can also reach us on Telegram at{' '}
          <span className="font-semibold text-ink-900">@vipaverra</span>. Telegram is an official
          human contact channel, but a ticket here is the authoritative record. Nothing sent on
          Telegram can credit a deposit, approve a withdrawal, or grant a financial exception.
        </p>
      </Card>

      <section className="mt-8">
        <SectionHeading
          title="Your tickets"
          action={
            <ButtonLink href="/support/new" size="sm">
              New ticket
            </ButtonLink>
          }
        />

        {tickets === null || tickets.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title={tickets === null ? 'Could not load your tickets' : 'No support tickets'}
              description={
                tickets === null
                  ? 'We could not reach the support service. Please try again shortly.'
                  : 'Open a ticket and a human agent will reply. Replies are written by people, never generated.'
              }
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {tickets.map((ticket) => {
              const status = String(ticket.status);

              return (
                <li key={ticket.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-ink-900">{ticket.subject}</h2>
                        <p className="mt-1 font-mono text-xs text-ink-400">{ticket.reference}</p>
                        <p className="mt-2 text-xs text-ink-500">
                          Opened {new Date(ticket.createdAt).toLocaleDateString()}
                          {ticket.firstResponseAt
                            ? ` · first human reply ${new Date(ticket.firstResponseAt).toLocaleDateString()}`
                            : ' · awaiting first human reply'}
                        </p>
                      </div>

                      <Pill tone={status === 'OPEN' ? 'warning' : 'neutral'}>
                        {status.replace(/_/g, ' ').toLowerCase()}
                      </Pill>
                    </div>

                    <div className="mt-4">
                      <ButtonLink href={`/support/${ticket.id}`} variant="secondary" size="sm">
                        Open ticket
                      </ButtonLink>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
