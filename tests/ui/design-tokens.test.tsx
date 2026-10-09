import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MoneyState, type MoneyState as MoneyStateValue } from '@/components/ui/MoneyState';
import { Pill } from '@/components/ui/Card';

// TWO RULES THIS PROTECTS
//
// 1. TWO DIFFERENT FINANCIAL STATES MUST NOT SHARE A BADGE.
//    `STYLE` in MoneyState.tsx mapped both `eligible` and `reserved` to
//    `pill: 'warning'`, and `PILL_TONE` defined `warning` and `gamify` as the
//    same colour at /30 and /25 of one hue. So "verified and owed to you" and
//    "already claimed by a withdrawal you started" rendered as one badge, and
//    that badge also matched the gold used for virtual XP.
//
//    This is doc 09 TRANSPARENCY failing inside the component that exists to
//    implement it. The hints differ, so the information is technically present -
//    but a badge is what a user reads first.
//
// 2. NO COMPONENT MAY PICK FROM A VENDOR'S PALETTE.
//    `red-100`, `amber-500` and friends were used in fifteen files while the
//    design system documented "no hardcoded hex values" as a rule. The tokens
//    existed; the components ignored them. A dark theme cannot be applied to
//    twenty call sites one at a time, and this is why it had to be a token
//    refactor rather than a stylesheet override.

const ALL_STATES: readonly MoneyStateValue[] = [
  'pending',
  'eligible',
  'settled',
  'reserved',
  'failed',
];

function badgeClass(state: MoneyStateValue): string {
  const { container, unmount } = render(<MoneyState state={state} amount="10.00" />);
  const badge = container.querySelector('span.inline-flex');
  const value = badge?.className ?? '';
  unmount();
  return value;
}

describe('MoneyState gives distinct financial states distinct appearances', () => {
  it('separates eligible from reserved, which used to be the same badge', () => {
    // THE regression. Against the old mapping these two are identical.
    expect(badgeClass('eligible')).not.toBe(badgeClass('reserved'));
  });

  it('never reuses one badge across two different states', () => {
    // The general form of the rule, so a future state cannot reintroduce the
    // defect by adding one more entry to a shared tone.
    const classes = ALL_STATES.map(badgeClass);

    expect(new Set(classes).size).toBe(ALL_STATES.length);
  });

  it('still gives every state a distinct human label', () => {
    // The labels are the accessible half of the fix. Colour alone is never enough.
    for (const [state, label] of [
      ['pending', 'Pending'],
      ['eligible', 'Eligible'],
      ['settled', 'Available'],
      ['reserved', 'Reserved'],
      ['failed', 'Not payable'],
    ] as const) {
      const { unmount } = render(<MoneyState state={state} amount="10.00" />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('explains every state in words, not colour alone', () => {
    render(<MoneyState state="reserved" amount="10.00" />);
    expect(screen.getByText(/in-flight withdrawal/)).toBeInTheDocument();
  });
});

describe('Pill holds warning apart from gamify', () => {
  it('does not render the two with the same classes', () => {
    const { container: a, unmount: ua } = render(<Pill tone="warning">w</Pill>);
    const warning = a.firstElementChild?.className ?? '';
    ua();

    const { container: b, unmount: ub } = render(<Pill tone="gamify">g</Pill>);
    const gamify = b.firstElementChild?.className ?? '';
    ub();

    expect(warning).not.toBe(gamify);
  });

  it('keeps gamify out of the brand green, so a virtual reward is never money', () => {
    const { container } = render(<Pill tone="gamify">+50 XP</Pill>);

    // Doc 47 SEPARATION. Green is reserved for settled money.
    expect(container.firstElementChild?.className ?? '').not.toContain('brand-');
  });
});

// The second rule is asserted by reading source, because a behavioural test cannot
// tell `bg-danger-100` from `bg-red-100` - they render the same colour. The only way
// to assert the ABSENCE of a vendor palette from files whose job is to use ours is
// to read them.
//
// This is the check AGENTS.md warns about, so it enumerates: it reports how many
// files it scanned beside how many were bad, so a pattern that silently matches
// nothing reads as `N scanned, 0 bad` rather than as a bare `0 bad`.
describe('components use design tokens, not a vendor palette', () => {
  const files: string[] = (() => {
    const found: string[] = [];
    const stack = ['src/components', 'src/app'];

    while (stack.length) {
      const dir = stack.pop() as string;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = join(dir, entry);

        let isDirectory: boolean;
        try {
          isDirectory = statSync(full).isDirectory();
        } catch {
          continue;
        }

        if (isDirectory) stack.push(full);
        else if (/\.(tsx|ts)$/.test(entry)) found.push(full);
      }
    }

    return found;
  })();

  // Tailwind's DEFAULT palette. Our tokens are `brand`, `ink`, `danger`,
  // `warning`, `locked`, `gamify` and `canvas`, none of which appear here.
  //
  // `neutral` and `stone` ARE excluded deliberately for a different reason: the
  // token `--color-ink-*` replaced Tailwind's neutral scale, and `bg-neutral-`
  // in a file would be the same drift as `bg-red-`.
  const VENDOR_PALETTE =
    /\b(?:bg|text|border|ring|from|to|fill|stroke|outline|decoration|accent|caret|divide|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;

  it('scanned a real population', () => {
    // Guards the guard. If the walk ever returns nothing, the assertion below
    // passes vacuously - which is the exact failure mode of the Q-22 leak check,
    // where a predicate matching zero rows was reported as a security assurance.
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds no component using a vendor palette colour', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (VENDOR_PALETTE.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(process.cwd(), file));
      }
    }

    // The population is reported beside the bad count, deliberately.
    const summary = `${files.length} scanned, ${offenders.length} bad${
      offenders.length ? `: ${offenders.join(', ')}` : ''
    }`;

    expect(summary).toBe(`${files.length} scanned, 0 bad`);
  });
});
