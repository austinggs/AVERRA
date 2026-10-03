'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, Pill } from '@/components/ui/Card';
import { shouldApplySnapshot, type SceneMachine } from '@/lib/game/scene';

// The 3D scene panel (docs 17, 31).
//
// WHY THIS IS LAZY-LOADED
//
// Three.js is roughly 600KB minified and has no business blocking first paint on a
// mobile connection. `next/dynamic` with `ssr: false` keeps it out of the initial
// bundle and off the server, so the DOM shell renders immediately and the scene
// arrives after. It also means a failure inside the 3D layer cannot fail the page.
//
// WHAT THIS FETCHES
//
// `GET /api/game`, which returns the authoritative snapshot from
// `public.get_game_state`. Read-only. This panel sends no actions - `GameShell`
// below owns every mutation, so there is exactly one place a game action can be
// issued from.

const GameScene = dynamic(() => import('./GameScene').then((m) => m.GameScene), {
  ssr: false,
  loading: () => (
    <div className="grid h-48 w-full place-items-center sm:h-64">
      <p className="text-xs text-ink-500">Loading the pit view...</p>
    </div>
  ),
});

type Snapshot = {
  enrolled: boolean;
  player?: { stateVersion?: string; level?: number } | null;
  machines?: SceneMachine[];
};

export function GameScenePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // The version currently on screen. Guarding against a stale snapshot is what
  // stops a late response from resurrecting state the server already replaced
  // (doc 31 CONCURRENCY).
  const versionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/game');
        if (!response.ok) return;

        const body = (await response.json()) as Snapshot;
        if (cancelled) return;

        const incoming = body.player?.stateVersion ?? null;
        if (!shouldApplySnapshot(versionRef.current, incoming)) return;

        versionRef.current = incoming;
        setSnapshot({ ...body, machines: body.machines ?? [] });
      } catch {
        // A failed read leaves the scene absent, not broken. The DOM shell below
        // remains the working surface.
        if (!cancelled) setUnavailable(true);
      }
    };

    const kick = setTimeout(() => void load(), 0);
    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, []);

  const machines = snapshot?.machines ?? [];

  const running = machines.filter((m) => m.state === 'RUNNING').length;
  const broken = machines.filter((m) => m.state === 'BROKEN').length;
  const upgrading = machines.filter((m) => m.state === 'UPGRADING').length;

  return (
    <Card tone="sunken" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Your pit</h2>

        <div className="flex flex-wrap gap-1.5">
          {running > 0 ? <Pill tone="brand">{running} running</Pill> : null}
          {upgrading > 0 ? <Pill tone="warning">{upgrading} upgrading</Pill> : null}
          {broken > 0 ? <Pill tone="danger">{broken} broken</Pill> : null}
        </div>
      </div>

      {snapshot && !snapshot.enrolled ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          Enroll in the Mining Game from the panel below to place your first extractor.
        </p>
      ) : null}

      {unavailable ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          The 3D view is unavailable right now. Everything below still works.
        </p>
      ) : machines.length === 0 && snapshot ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          No machines placed yet. Deploy an extractor to see it here.
        </p>
      ) : null}

      {!unavailable && machines.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-tile border border-ink-100">
          <GameScene
            machines={machines}
            label={`Mining Game pit: ${machines.length} machines, ${running} running, ${broken} broken`}
          />
        </div>
      ) : null}

      {/*
        Law 26 stated on the surface itself: what this scene shows is virtual. A
        player must never read a game resource as money.
      */}
      <p className="mt-3 text-xs leading-relaxed text-ink-500">
        This view is a rendering of server state. It shows virtual game resources, which are not
        money and never become a balance. Every action you take below is validated on the server.
      </p>
    </Card>
  );
}
