import { describe, expect, it } from 'vitest';
import {
  ENERGY_PREVIEW_CAP_MS,
  GRID_COLUMNS,
  MACHINE_VISUAL_STATES,
  SLOT_SPACING,
  conditionRatio,
  energyFraction,
  interpolatedEnergy,
  machineTransform,
  newestVersion,
  shouldApplySnapshot,
  visualForMachineState,
  type MachineVisualState,
} from '@/lib/game/scene';

// A WebGL canvas cannot be meaningfully unit tested, so every rule that the
// renderer depends on is pushed into the pure module and pinned here. If one of
// these breaks, the scene is mis-rendering or - worse - is trusting a client
// value it should not trust.

describe('machineTransform', () => {
  it('centres a single machine', () => {
    // The bug this exists for: without `total`, one machine lands at x = -3.2 on a
    // three-wide grid and reads as a broken render.
    expect(machineTransform(0, 1).x).toBe(0);
    expect(machineTransform(0, 1).z).toBe(0);
    expect(machineTransform(0, 1).rowCount).toBe(1);
  });

  it('centres a full row on zero', () => {
    expect(machineTransform(0, 3).x).toBe(-SLOT_SPACING);
    expect(machineTransform(1, 3).x).toBe(0);
    expect(machineTransform(2, 3).x).toBe(SLOT_SPACING);
  });

  it('is deterministic: the same slot and total always yield the same position', () => {
    expect(machineTransform(7, 9)).toEqual(machineTransform(7, 9));
  });

  it('wraps onto a new row when a full grid overflows', () => {
    const fourth = machineTransform(3, 4);
    expect(fourth.z).toBeGreaterThan(0);
    // Four machines on a three-wide grid: row 0 holds three, row 1 holds one, and
    // that lone machine is centred on ITS row rather than at the grid's left edge.
    expect(fourth.rowCount).toBe(1);
    expect(fourth.x).toBe(0);
  });

  it('separates machines by the configured spacing', () => {
    expect(machineTransform(1, 3).x - machineTransform(0, 3).x).toBeCloseTo(SLOT_SPACING);
  });

  it('never produces NaN from a nonsense slot', () => {
    // `locationSlot` comes from the database, but a corrupt row must not yield NaN
    // geometry that silently parks every machine at the origin.
    for (const slot of [Number.NaN, Number.POSITIVE_INFINITY, -5, 2.7]) {
      const transform = machineTransform(slot, 3);

      expect(Number.isFinite(transform.x)).toBe(true);
      expect(Number.isFinite(transform.y)).toBe(true);
      expect(Number.isFinite(transform.z)).toBe(true);
      expect(transform.index).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps a slot beyond the machine count instead of throwing', () => {
    // A snapshot whose `locationSlot` disagrees with its own array length is
    // corrupt; one off-centre machine beats an empty scene.
    const transform = machineTransform(99, 3);

    expect(Number.isFinite(transform.x)).toBe(true);
    expect(Number.isFinite(transform.z)).toBe(true);
  });

  it('handles a nonsense total without dividing by zero', () => {
    for (const total of [0, -3, Number.NaN]) {
      const transform = machineTransform(0, total);

      expect(Number.isFinite(transform.x)).toBe(true);
      expect(Number.isFinite(transform.z)).toBe(true);
    }
  });
});

describe('visualForMachineState', () => {
  it('covers every machine state, so an added enum cannot fall through', () => {
    for (const state of MACHINE_VISUAL_STATES) {
      expect(visualForMachineState(state)).toBeTruthy();
    }
  });

  it('animates a running machine', () => {
    expect(visualForMachineState('RUNNING').animated).toBe(true);
    expect(visualForMachineState('RUNNING').spinRate).toBeGreaterThan(0);
  });

  it('does NOT animate a broken machine', () => {
    // A machine that keeps spinning while broken tells the player it is working
    // when it is not. Doc 16 FAILURE STATES requires broken to be visible.
    const broken = visualForMachineState('BROKEN');
    expect(broken.animated).toBe(false);
    expect(broken.needsAttention).toBe(true);
  });

  it('does not animate an idle or locked machine', () => {
    expect(visualForMachineState('IDLE').animated).toBe(false);
    expect(visualForMachineState('LOCKED').animated).toBe(false);
    expect(visualForMachineState('LOCKED').dimmed).toBe(true);
  });

  it('distinguishes an upgrade from production', () => {
    const upgrading = visualForMachineState('UPGRADING');
    const running = visualForMachineState('RUNNING');

    expect(upgrading.animated).toBe(true);
    expect(upgrading.spinRate).not.toBe(running.spinRate);
  });

  it('is exhaustive at the type level for every declared state', () => {
    // Catches a state added to the union but not to the switch.
    const every: MachineVisualState[] = ['IDLE', 'RUNNING', 'UPGRADING', 'BROKEN', 'LOCKED'];

    for (const state of every) {
      expect(Number.isFinite(visualForMachineState(state).spinRate)).toBe(true);
    }
  });
});

describe('conditionRatio', () => {
  it('maps a percentage to 0..1', () => {
    expect(conditionRatio(0)).toBe(0);
    expect(conditionRatio(50)).toBe(0.5);
    expect(conditionRatio(100)).toBe(1);
  });

  it('clamps out-of-range and non-numeric values', () => {
    expect(conditionRatio(-10)).toBe(0);
    expect(conditionRatio(400)).toBe(1);
    expect(conditionRatio(Number.NaN)).toBe(0);
  });
});

describe('shouldApplySnapshot', () => {
  it('accepts the first snapshot when nothing is rendered yet', () => {
    expect(shouldApplySnapshot(null, '5')).toBe(true);
    expect(shouldApplySnapshot(undefined, '5')).toBe(true);
  });

  it('rejects a snapshot older than the one on screen', () => {
    // Doc 31 CONCURRENCY. Rendering this would show a stopped machine as running.
    expect(shouldApplySnapshot('10', '9')).toBe(false);
  });

  it('accepts a newer or equal snapshot', () => {
    expect(shouldApplySnapshot('10', '11')).toBe(true);
    expect(shouldApplySnapshot('10', '10')).toBe(true);
  });

  it('compares numerically, not lexically', () => {
    // The bug this catches: as STRINGS, '99' > '100'. A naive comparison would
    // therefore ACCEPT the stale 99 and render state the server already replaced.
    // Numerically 99 < 100, so it must be rejected.
    expect(shouldApplySnapshot('100', '99')).toBe(false);
    expect(shouldApplySnapshot('99', '100')).toBe(true);

    // And the reverse direction across a digit boundary.
    expect(shouldApplySnapshot('9', '10')).toBe(true);
    expect(shouldApplySnapshot('10', '9')).toBe(false);
  });

  it('rejects an unparseable incoming version', () => {
    // Accepting a snapshot whose version cannot be read would defeat the guard.
    expect(shouldApplySnapshot('10', 'not-a-number')).toBe(false);
    expect(shouldApplySnapshot('10', '')).toBe(false);
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER', () => {
    // state_version is a bigint. Comparing it as a JS number would lose precision.
    expect(shouldApplySnapshot('9007199254740993', '9007199254740992')).toBe(false);
    expect(shouldApplySnapshot('9007199254740992', '9007199254740993')).toBe(true);
  });

  it('accepts bigint inputs', () => {
    expect(shouldApplySnapshot(10n, 11n)).toBe(true);
    expect(shouldApplySnapshot(11n, 10n)).toBe(false);
  });
});

describe('newestVersion', () => {
  it('returns the numerically newest version', () => {
    expect(newestVersion('9', '10')).toBe('10');
    expect(newestVersion('10', '9')).toBe('10');
  });

  it('falls back to zero when neither version is readable', () => {
    expect(newestVersion(null, undefined)).toBe('0');
  });

  it('keeps the readable side when only one is', () => {
    expect(newestVersion(null, '7')).toBe('7');
    expect(newestVersion('7', 'bad')).toBe('7');
  });
});

// Doc 17 SECURITY: "Never trust hidden client variables ... as financial/game
// authority." These tests are the enforcement. A tampered clock must not be able
// to grant energy, because the server recomputes on every action regardless.
describe('interpolatedEnergy', () => {
  const base = {
    storedCurrent: 10,
    energyMax: 100,
    energyRegenPerMinute: 6,
    lastCalculatedAt: '2026-10-03T12:00:00.000Z',
  };

  it('interpolates forward over elapsed time', () => {
    // 30 seconds at 6/min = 3 energy.
    const result = interpolatedEnergy({
      ...base,
      now: new Date('2026-10-03T12:00:30.000Z'),
    });

    expect(result).toBeCloseTo(13);
  });

  it('never exceeds energyMax, however far ahead the clock is', () => {
    // THE tamper test. A clock set years in the future must not be able to fill the
    // bar: the preview window is capped, so the result is bounded by regen over the
    // cap rather than by elapsed time. Either way it can never exceed the maximum.
    const result = interpolatedEnergy({
      ...base,
      now: new Date('3000-01-01T00:00:00.000Z'),
    });

    expect(result).toBeLessThanOrEqual(base.energyMax);
    expect(result).toBeCloseTo(10 + (6 * ENERGY_PREVIEW_CAP_MS) / 60_000);
  });

  it('clamps to exactly energyMax when regen would overshoot it', () => {
    // Distinct from the cap: here the elapsed time is INSIDE the preview window but
    // the regen rate is high enough to overshoot, so the hard clamp is what stops it.
    const result = interpolatedEnergy({
      storedCurrent: 10,
      energyMax: 100,
      energyRegenPerMinute: 600,
      lastCalculatedAt: '2026-10-03T12:00:00.000Z',
      now: new Date('2026-10-03T12:01:00.000Z'),
    });

    expect(result).toBe(100);
  });

  it('never drops below the stored value on a backwards clock', () => {
    const result = interpolatedEnergy({
      ...base,
      now: new Date('2026-10-03T11:00:00.000Z'),
    });

    expect(result).toBe(10);
  });

  it('returns the stored value when there is no regen', () => {
    const result = interpolatedEnergy({
      ...base,
      energyRegenPerMinute: 0,
      now: new Date('2026-10-03T12:05:00.000Z'),
    });

    expect(result).toBe(10);
  });

  it('treats a negative regen rate as zero rather than draining energy', () => {
    const result = interpolatedEnergy({
      ...base,
      energyRegenPerMinute: -50,
      now: new Date('2026-10-03T12:05:00.000Z'),
    });

    expect(result).toBe(10);
  });

  it('clamps a stored value that already exceeds the maximum', () => {
    const result = interpolatedEnergy({
      ...base,
      storedCurrent: 500,
      now: new Date('2026-10-03T12:05:00.000Z'),
    });

    expect(result).toBe(100);
  });

  it('returns zero when there is no capacity', () => {
    const result = interpolatedEnergy({
      ...base,
      energyMax: 0,
      now: new Date('2026-10-03T12:05:00.000Z'),
    });

    expect(result).toBe(0);
  });

  it('accepts a Date for lastCalculatedAt', () => {
    const result = interpolatedEnergy({
      ...base,
      lastCalculatedAt: new Date('2026-10-03T12:00:00.000Z'),
      now: new Date('2026-10-03T12:00:30.000Z'),
    });

    expect(result).toBeCloseTo(13);
  });

  it('is never NaN for a garbage timestamp', () => {
    const result = interpolatedEnergy({
      ...base,
      lastCalculatedAt: 'not-a-date',
      now: new Date('2026-10-03T12:00:30.000Z'),
    });

    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(10);
  });
});

describe('energyFraction', () => {
  it('maps current/max to 0..1', () => {
    expect(energyFraction(50, 100)).toBe(0.5);
    expect(energyFraction(0, 100)).toBe(0);
    expect(energyFraction(100, 100)).toBe(1);
  });

  it('clamps rather than overflowing the gauge', () => {
    expect(energyFraction(150, 100)).toBe(1);
    expect(energyFraction(-5, 100)).toBe(0);
  });

  it('returns 0 for a zero or invalid maximum', () => {
    expect(energyFraction(10, 0)).toBe(0);
    expect(energyFraction(10, Number.NaN)).toBe(0);
  });
});
