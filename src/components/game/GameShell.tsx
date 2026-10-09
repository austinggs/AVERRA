'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, Pill } from '@/components/ui/Card';

// The Mining Game client (docs 15-17, 31).
//
// CLIENT RESPONSIBILITIES, per doc 31: rendering, input collection, animation,
// interpolation, cached display and non-authoritative prediction.
//
// THIS COMPONENT COMPUTES NOTHING THAT MATTERS.
// - It never calculates production. The server does.
// - It never grants energy. The countdown is a local animation from a server
//   timestamp; the server recomputes on every action, so tampering with it buys
//   nothing.
// - It never mutates a balance. Every action is a POST that returns the
//   authoritative version, and the local view is replaced by that response.
//
// LAW 26: inventory shown here is virtual game resources. It is not money and it
// never becomes wallet balance.

interface MachineView {
  id: string;
  state: string;
  level: number;
  condition: number;
  lastProducedAt: string;
  type: {
    code: string;
    name: string;
    energyCost: number;
    productionIntervalSeconds: number;
    baseOutputMinor: number;
  } | null;
}

interface GameState {
  enrolled: boolean;
  player?: {
    level: number;
    xp: number;
    energyCurrent: number;
    energyMax: number;
    energyRegenPerMinute: number;
    energyLastCalculatedAt: string;
    stateVersion: number;
  };
  machines: MachineView[];
  inventory: Array<{
    resourceId: string;
    quantity: string;
    code: string | null;
    name: string | null;
  }>;
  missions: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    objectives: unknown;
    rewardQuantity: string;
  }>;
  achievements: Array<{
    id: string;
    name: string | null;
    badgeCode: string | null;
    xpReward: number;
  }>;
}

/** A unique id per action attempt, so a retried request is a replay not a repeat. */
function newActionId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function GameShell() {
  const [state, setState] = useState<GameState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Ticks once a second purely to re-render the energy countdown.
  const [now, setNow] = useState(() => Date.now());
  const versionRef = useRef<bigint | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/game');
    if (!res.ok) return;

    const body = (await res.json()) as GameState;
    setState(body);

    if (body.player) {
      versionRef.current = BigInt(body.player.stateVersion);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: `load` performs a network read and sets state when it
    // resolves. Calling it synchronously here would cascade a render on mount.
    const kick = setTimeout(() => void load(), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [load]);

  /**
   * PRESENTATION ONLY (doc 22). An interpolation between two server facts, never
   * a source of truth. The server recomputes energy on every action, so an
   * altered clock here cannot grant energy.
   */
  function displayedEnergy(player: NonNullable<GameState['player']>): number {
    const last = new Date(player.energyLastCalculatedAt).getTime();
    const minutes = Math.max(0, (now - last) / 60_000);
    const regenerated = Math.floor(minutes * player.energyRegenPerMinute);
    return Math.min(player.energyMax, player.energyCurrent + regenerated);
  }

  async function act(payload: Record<string, unknown>) {
    setMessage(null);

    const res = await fetch('/api/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        actionId: newActionId(),
        expectedVersion: versionRef.current?.toString(),
      }),
    });

    const body = (await res.json()) as {
      error?: { code: string; message: string };
      replayed?: boolean;
      message?: string;
      stateVersion?: number | null;
    };

    if (!res.ok || body.error) {
      setMessage(body.error?.message ?? 'That action could not be completed.');

      // A version conflict means our view is stale. Resync rather than retry
      // against a state we no longer hold.
      if (body.error?.code === 'conflict') {
        void load();
      }
      return;
    }

    if (body.stateVersion !== null && body.stateVersion !== undefined) {
      versionRef.current = BigInt(body.stateVersion);
    }

    setMessage(
      body.message ?? (body.replayed ? 'Already recorded — nothing was applied twice.' : null),
    );
    await load();
  }

  if (!state) {
    return (
      <Card tone="sunken">
        <p className="text-sm text-ink-500">Loading your mine…</p>
      </Card>
    );
  }

  if (!state.enrolled || !state.player) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-ink-900">Your mine is not set up yet</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Deploy your first extractor to start playing. Machines and resources are virtual game
          items, not money.
        </p>
        <div className="mt-4">
          <Button
            size="sm"
            onClick={() => void act({ action: 'DEPLOY', machineTypeCode: 'ore_basic' })}
          >
            Deploy Basic Extractor
          </Button>
        </div>
        {message ? (
          <p role="alert" className="mt-3 text-sm text-danger-700">
            {message}
          </p>
        ) : null}
      </Card>
    );
  }

  const player = state.player;
  const energy = displayedEnergy(player);
  const energyPct = Math.round((energy / player.energyMax) * 100);

  return (
    <div className="space-y-4">
      {/* Law 26 stated in the UI itself. A player must never read a game number
          as a balance. */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ink-500">Level {player.level}</p>
            <p className="mt-1 text-sm font-semibold text-ink-900">{player.xp} XP</p>
          </div>
          <Pill tone="gamify">Virtual game stats, not money</Pill>
        </div>

        <div className="mt-4 border-t border-ink-100 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ink-500">Energy</span>
            <span className="text-sm font-semibold tabular-nums text-ink-900">
              {energy} / {player.energyMax}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={energy}
            aria-valuemin={0}
            aria-valuemax={player.energyMax}
            aria-label="Energy remaining"
            className="mt-2 h-2.5 w-full overflow-hidden rounded-pill bg-ink-100"
          >
            <div
              className="h-full rounded-pill bg-brand-500 transition-[width] duration-1000"
              style={{ width: `${energyPct}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-ink-500">
            Regenerates {player.energyRegenPerMinute} per minute. This countdown is a display; the
            server recalculates energy on every action.
          </p>
        </div>
      </Card>

      {message ? (
        <Card tone="sunken">
          <p role="status" className="text-sm text-ink-700">
            {message}
          </p>
        </Card>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-ink-900">Your machines</h2>

        {state.machines.length === 0 ? (
          <Card tone="sunken" className="mt-3">
            <p className="text-sm leading-relaxed text-ink-500">
              No machines deployed yet. Deploy a Basic Extractor to start mining.
            </p>
            {/* Doc 20 SERVER AUTHORITY: the server checks availability and the
                unlock level. The button is an affordance, not the gate. */}
            <div className="mt-4">
              <Button
                size="sm"
                onClick={() => void act({ action: 'DEPLOY', machineTypeCode: 'ore_basic' })}
              >
                Deploy Basic Extractor
              </Button>
            </div>
          </Card>
        ) : (
          <ul className="mt-3 space-y-3">
            {state.machines.map((machine) => (
              <li key={machine.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-ink-900">
                        {machine.type?.name ?? 'Machine'}
                      </h3>
                      <p className="mt-1 text-xs text-ink-500">
                        Level {machine.level} · {Math.round(Number(machine.condition) * 100)}%
                        condition
                      </p>
                    </div>
                    <Pill tone={machine.state === 'RUNNING' ? 'brand' : 'neutral'}>
                      {machine.state.toLowerCase()}
                    </Pill>
                  </div>

                  {machine.type ? (
                    <p className="mt-3 text-xs leading-relaxed text-ink-500">
                      Costs {machine.type.energyCost} energy to start. Produces{' '}
                      {machine.type.baseOutputMinor} every {machine.type.productionIntervalSeconds}s
                      while running. The server computes the amount from elapsed time.
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {machine.state === 'IDLE' ? (
                      <Button
                        size="sm"
                        disabled={energy < (machine.type?.energyCost ?? 0)}
                        onClick={() => void act({ action: 'START', machineId: machine.id })}
                      >
                        Start
                      </Button>
                    ) : null}

                    {machine.state === 'RUNNING' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void act({ action: 'COLLECT', machineId: machine.id })}
                        >
                          Collect
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void act({ action: 'STOP', machineId: machine.id })}
                        >
                          Stop
                        </Button>
                      </>
                    ) : null}

                    {/* Doc 24 UPGRADE. The server checks level, energy, the
                        prerequisite chain and the machine's max level. */}
                    {machine.state !== 'UPGRADING' && machine.level < 10 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void act({
                            action: 'UPGRADE',
                            machineId: machine.id,
                            upgradeCode: 'extractor_tuning_1',
                          })
                        }
                      >
                        Upgrade
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-900">Inventory</h2>

        {state.inventory.length === 0 ? (
          <Card tone="sunken" className="mt-3">
            <p className="text-sm leading-relaxed text-ink-500">
              Nothing collected yet. Start a machine and collect its output.
            </p>
          </Card>
        ) : (
          <ul className="mt-3 space-y-2">
            {state.inventory.map((item) => (
              <li key={item.resourceId}>
                <Card className="flex items-center justify-between py-3">
                  <span className="text-sm text-ink-700">{item.name ?? item.code}</span>
                  {/* Deliberately no currency symbol and no MoneyState. These are
                      virtual resources and must never render as a balance. */}
                  <span className="text-sm font-semibold tabular-nums text-ink-900">
                    {item.quantity}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-sm font-semibold text-ink-900">Missions</h2>

        {(state.missions ?? []).length === 0 ? (
          <Card tone="sunken" className="mt-3">
            <p className="text-sm leading-relaxed text-ink-500">
              No missions are running right now.
            </p>
          </Card>
        ) : (
          <ul className="mt-3 space-y-3">
            {(state.missions ?? []).map((mission) => (
              <li key={mission.id}>
                <Card>
                  <h3 className="text-sm font-semibold text-ink-900">{mission.name}</h3>
                  {mission.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">
                      {mission.description}
                    </p>
                  ) : null}

                  {mission.rewardQuantity !== '0' ? (
                    <p className="mt-2 text-xs text-ink-700">
                      Reward: {mission.rewardQuantity} units of a game resource.
                    </p>
                  ) : null}

                  <div className="mt-4">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void act({ action: 'CLAIM_MISSION', missionCode: mission.code })
                      }
                    >
                      Claim
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(state.achievements ?? []).length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-ink-900">Achievements</h2>
          <ul className="mt-3 space-y-2">
            {(state.achievements ?? []).map((achievement) => (
              <li key={achievement.id}>
                <Card className="flex items-center justify-between py-3">
                  <span className="text-sm text-ink-700">{achievement.name}</span>
                  {/* Doc 27: XP and badges are game-native, not money. */}
                  <Pill tone="gamify">+{achievement.xpReward} XP</Pill>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
