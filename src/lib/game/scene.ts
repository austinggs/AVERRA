// Mining Game scene model (docs 16, 17, 31).
//
// PURE MODULE. No `server-only`, no DOM, no Three.js import, so it runs under
// vitest and is the only place where scene correctness can actually be proven. A
// WebGL canvas cannot be meaningfully unit tested, so the arithmetic that decides
// WHERE a machine sits and whether a snapshot is allowed to replace the current
// view lives here, and the renderer consumes it.
//
// WHAT THIS MODULE IS NOT
//
// It is not authority. Doc 31 makes progression, energy, inventory, machines,
// resources, mission progress and reward eligibility server-authoritative, and
// nothing in this file writes any of them. Every value here is derived from a
// snapshot returned by `public.get_game_state`.
//
// LAW 26: a game resource is a virtual quantity. Nothing here renders as money,
// converts to money, or may be described as a balance.

export const MACHINE_VISUAL_STATES = ['IDLE', 'RUNNING', 'UPGRADING', 'BROKEN', 'LOCKED'] as const;
export type MachineVisualState = (typeof MACHINE_VISUAL_STATES)[number];

/** Mirrors the `machines[]` projection of `public.get_game_state`. */
export type SceneMachine = {
  id: string;
  state: MachineVisualState;
  level: number;
  condition: number;
  /** Grid position assigned by the server. Never assigned by the client. */
  locationSlot: number;
  lastProducedAt: string;
  /** Per-machine version, used to discard a stale per-machine update. */
  stateVersion: string;
  type: {
    code: string;
    name: string;
    energyCost: number;
    productionIntervalSeconds: number;
    baseOutputMinor: number;
  } | null;
};

export type ScenePlayer = {
  level: number;
  xp: number;
  energyCurrent: number;
  energyMax: number;
  energyRegenPerMinute: number;
  energyLastCalculatedAt: string;
  stateVersion: string;
};

export type SceneSnapshot = {
  enrolled: boolean;
  player?: ScenePlayer | null;
  machines: SceneMachine[];
};

// --- Grid placement -----------------------------------------------------------
// A machine's position is DERIVED from `locationSlot`, which the server owns.
// Deriving x/y/z here rather than in the component means two clients rendering the
// same snapshot always produce the same world, and that a nonsense slot degrades
// to a defined position instead of `NaN` geometry at the origin.

export const GRID_COLUMNS = 3;
export const SLOT_SPACING = 3.2;

/** A slot that is missing, negative, or non-integer must not produce NaN. */
function normalizeSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const floored = Math.floor(slot);
  return floored < 0 ? 0 : floored;
}

export type MachineTransform = {
  x: number;
  y: number;
  z: number;
  /** Row-major index in the grid, for LOD and picking. */
  index: number;
  /** How many machines share this row, after centring. */
  rowCount: number;
};

/**
 * Places a machine in the world from its server-assigned `locationSlot`.
 *
 * `total` is how many machines exist. It is not decoration: without it a world
 * holding ONE machine lays that machine out on a three-wide grid, which renders it
 * at x = -3.2 instead of centred. A single machine sitting off to one side of an
 * otherwise empty viewport reads as a rendering bug, so each ROW is centred on the
 * number of machines actually in it rather than on the maximum row width.
 *
 * `slot` beyond `total - 1` is clamped to the last position rather than throwing:
 * a snapshot whose `locationSlot` disagrees with its own array length is corrupt,
 * and one off-centre machine is a far better failure than an empty scene.
 */
export function machineTransform(slot: number, total = GRID_COLUMNS): MachineTransform {
  const index = normalizeSlot(slot);
  const count = Number.isFinite(total) ? Math.max(Math.floor(total), 1) : GRID_COLUMNS;

  const columns = Math.min(GRID_COLUMNS, count);
  const clamped = Math.min(index, count - 1);

  const row = Math.floor(clamped / columns);
  const columnInRow = clamped % columns;
  const rowCount = Math.max(Math.min(columns, count - row * columns), 1);

  const offset = (rowCount - 1) / 2;

  return {
    x: (columnInRow - offset) * SLOT_SPACING,
    y: 0,
    z: row * SLOT_SPACING,
    index,
    rowCount,
  };
}

// --- Visual intent ------------------------------------------------------------
// Returns INTENT, not colour. Design tokens live in globals.css and are applied by
// the component, so this file has no opinion about how the game looks and its
// tests stay about behaviour.

export type MachineVisualIntent = {
  /** Whether the renderer animates this machine at all. */
  animated: boolean;
  /** Radians per second. Zero when not animated. */
  spinRate: number;
  /** Vertical bob amplitude in world units. */
  bobAmplitude: number;
  /** Rendered dimmed and non-interactive. */
  dimmed: boolean;
  /** Drives the warning treatment in the UI overlay. */
  needsAttention: boolean;
};

export function visualForMachineState(state: MachineVisualState): MachineVisualIntent {
  switch (state) {
    case 'RUNNING':
      return {
        animated: true,
        spinRate: 1.6,
        bobAmplitude: 0.08,
        dimmed: false,
        needsAttention: false,
      };
    case 'UPGRADING':
      // Animates but differently: slower, deeper, so an upgrade in progress is
      // distinguishable from production at a glance.
      return {
        animated: true,
        spinRate: 0.5,
        bobAmplitude: 0.18,
        dimmed: false,
        needsAttention: false,
      };
    case 'BROKEN':
      // Deliberately NOT animated. A machine that keeps spinning while broken
      // tells the player it is working when it is not.
      return { animated: false, spinRate: 0, bobAmplitude: 0, dimmed: false, needsAttention: true };
    case 'LOCKED':
      return { animated: false, spinRate: 0, bobAmplitude: 0, dimmed: true, needsAttention: false };
    case 'IDLE':
      return {
        animated: false,
        spinRate: 0,
        bobAmplitude: 0,
        dimmed: false,
        needsAttention: false,
      };
  }
}

/**
 * Wear as a 0..1 ratio, clamped.
 *
 * `condition` is a percentage-ish column, but a clamped ratio means a corrupt or
 * out-of-range value cannot scale a mesh to zero or blow it up.
 */
export function conditionRatio(condition: number): number {
  if (!Number.isFinite(condition)) return 0;
  return Math.min(Math.max(condition, 0), 100) / 100;
}

// --- Concurrency --------------------------------------------------------------
// Doc 31 CONCURRENCY requires optimistic versioning. Doc 17 NETWORKING says server
// responses carry "authoritative version/timestamp or sequence metadata to prevent
// stale state overwrites".
//
// This is the client half of that rule: a response that arrives out of order, or
// that was rendered optimistically before a newer snapshot landed, must not be
// allowed to overwrite newer state. Rendering it would show a machine that has
// already been stopped as running again, which is worse than a brief stale frame.

function toBigInt(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;

  try {
    if (typeof value === 'bigint') return value;
    return BigInt(String(value));
  } catch {
    // An unparseable version is treated as absent rather than as zero. Defaulting
    // to 0 would let a malformed snapshot pass a stale check it should fail.
    return null;
  }
}

/**
 * True when `incoming` is at least as new as `current` and may replace it.
 *
 * An absent `current` accepts anything: the first snapshot always applies.
 * An absent or unparseable `incoming` is REJECTED, because accepting a snapshot
 * whose version we cannot read would defeat the guard entirely.
 */
export function shouldApplySnapshot(
  current: string | number | bigint | null | undefined,
  incoming: string | number | bigint | null | undefined,
): boolean {
  const incomingVersion = toBigInt(incoming);
  if (incomingVersion === null) return false;

  const currentVersion = toBigInt(current);
  if (currentVersion === null) return true;

  return incomingVersion >= currentVersion;
}

/**
 * The newest of two snapshot versions, as a string.
 *
 * Used after an optimistic prediction so the renderer never regresses to an older
 * version number when two responses settle in the wrong order.
 */
export function newestVersion(
  a: string | number | bigint | null | undefined,
  b: string | number | bigint | null | undefined,
): string {
  const versionA = toBigInt(a);
  const versionB = toBigInt(b);

  if (versionA === null) return versionB === null ? '0' : String(versionB);
  if (versionB === null) return String(versionA);

  return String(versionA >= versionB ? versionA : versionB);
}

// --- Energy: PRESENTATION ONLY ------------------------------------------------
//
// This is the single most dangerous function in the file, so it is worth stating
// exactly what it is NOT.
//
// It does NOT compute energy. The server recomputes energy on every action
// (doc 31 REQUEST VALIDATION), so an altered clock in this browser buys nothing.
// Its output is never sent anywhere and never compared against `energyCurrent` as
// if it were truth. It exists so the gauge can move smoothly between server ticks
// instead of stepping once a minute, and it is therefore:
//
//   - clamped to [0, energyMax]      a tampered clock cannot show a full bar
//   - bounded by an explicit cap      a tampered clock cannot run the bar away
//   - never able to exceed the max   even with a huge elapsed time
//
// The single most important test in tests/game/scene.test.ts is that a clock set
// to the year 3000 still returns exactly `energyMax`.

export const ENERGY_PREVIEW_CAP_MS = 5 * 60 * 1000;

export type EnergyPreviewInput = {
  /** Authoritative stored energy. The floor and the ceiling for the preview. */
  storedCurrent: number;
  energyMax: number;
  energyRegenPerMinute: number;
  /** Server timestamp of the last authoritative calculation. */
  lastCalculatedAt: string | Date;
  /** Present local time. Never trusted for anything but a visual delta. */
  now: Date;
};

export function interpolatedEnergy(input: EnergyPreviewInput): number {
  const max = Number.isFinite(input.energyMax) ? Math.max(input.energyMax, 0) : 0;

  if (!Number.isFinite(input.storedCurrent)) return max;
  if (max === 0) return 0;

  const stored = Math.min(Math.max(input.storedCurrent, 0), max);
  const regen = Number.isFinite(input.energyRegenPerMinute)
    ? Math.max(input.energyRegenPerMinute, 0)
    : 0;

  const last =
    input.lastCalculatedAt instanceof Date
      ? input.lastCalculatedAt
      : new Date(input.lastCalculatedAt);
  const elapsedMs = input.now.getTime() - last.getTime();

  // A negative or absent delta means the local clock disagrees with the server.
  // Falling back to the stored value is the honest response: show what the server
  // said, rather than inventing motion from a clock we do not trust.
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return stored;

  const cappedMs = Math.min(elapsedMs, ENERGY_PREVIEW_CAP_MS);
  const elapsedMinutes = cappedMs / 60_000;
  const preview = stored + regen * elapsedMinutes;

  // The hard clamp. This is what makes a tampered clock harmless.
  //
  // Two independent guards sit here, and the suite pins BOTH separately:
  //   - ENERGY_PREVIEW_CAP_MS bounds elapsed time (pinned by the year-3000 test)
  //   - this clamp bounds the result against energyMax (pinned by the two tests
  //     that fail when it is removed)
  // Removing this clamp leaves the year-3000 test passing, because the cap already
  // covers that case. That is correct, not a gap: each guard has its own test.
  return Math.min(Math.max(preview, stored), max);
}

/**
 * Fraction of energy for a progress bar, clamped to 0..1.
 *
 * A zero maximum yields 1 rather than NaN, so a player with no energy capacity
 * sees an empty bar instead of a broken gauge.
 */
export function energyFraction(current: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  if (!Number.isFinite(current)) return 0;

  return Math.min(Math.max(current / max, 0), 1);
}
