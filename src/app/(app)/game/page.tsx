import { requireUser } from '@/lib/auth/session';
import { PageHeader } from '@/components/ui/PageHeader';
import { GameShell } from '@/components/game/GameShell';
import { GameScenePanel } from '@/components/game/GameScenePanel';

export const metadata = { title: 'Mining Game - Averra' };

// The Mining Game (docs 15-19, 31).
//
// Law 26 is stated on the page itself, not only in code: a player must never
// read a game resource as money. The shell renders server-authoritative state
// and sends actions; it computes nothing that decides an outcome.
//
// The 3D panel is ADDED ABOVE the shell rather than replacing it. Doc 31 splits
// rendering from authority, and doc 17 says Three.js "does not authoritatively
// decide inventory, rewards, progression, or energy" - so the 3D layer is a view
// over the same authoritative snapshot, and `GameShell` remains the single place
// a game action is issued from. GameShell is deliberately not modified.

export default async function GamePage() {
  await requireUser();

  return (
    <div>
      <PageHeader
        title="Mining Game"
        description="Operate extractors, manage energy and collect resources. Every value here is computed and validated on the server."
      />

      <div className="mt-6">
        <GameScenePanel />
      </div>

      <div className="mt-6">
        <GameShell />
      </div>
    </div>
  );
}
