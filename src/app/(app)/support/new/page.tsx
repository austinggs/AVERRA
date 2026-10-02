import { requireUser } from '@/lib/auth/session';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { NewTicketForm } from '@/components/support/NewTicketForm';

export const metadata = { title: 'New support ticket - Averra' };

export default async function NewTicketPage() {
  await requireUser();

  return (
    <div>
      <PageHeader
        title="Open a ticket"
        description="A human agent reads every ticket and writes the reply. No automated system or AI responds."
      />

      <div className="mt-6">
        <NewTicketForm />
      </div>

      <Card tone="sunken" className="mt-4">
        <p className="text-xs leading-relaxed text-ink-500">
          Never include your password, a one-time code or a private key. Support will never ask for
          them, and an agent who did would be acting outside policy.
        </p>
      </Card>
    </div>
  );
}
