import { requireUser } from '@/lib/auth/session';
import { PageHeader } from '@/components/ui/PageHeader';
import { GameShell } from '@/components/game/GameShell';

export const metadata = { title: 'Mining Game - Averra' };

// The Mining Game (docs 15-19, 31).
//
// Law 26 is stated on the page itself, not only in code: a player must never
// read a game resource as money. The shell renders server-authoritative state
// and sends actions; it computes nothing that decides an outcome.

export default async function GamePage() {
  await requireUser();

  return (
    <div>
      <PageHeader
        title="Mining Game"
        description="Operate extractors, manage energy and collect resources. Every value here is computed and validated on the server."
      />

      <div className="mt-6">
        <GameShell />
      </div>
    </div>
  );
}
