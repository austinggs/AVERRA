'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Animated counters for the trust strip.
//
// THESE ARE PRODUCT FACTS, NOT METRICS.
//
// Every figure here is a STATIC PROPERTY OF HOW THE PLATFORM WORKS: the fee
// rate, the number of balances, the minimum claim age. None of it is a count
// read from the database, and none of it is a user total. That matters twice
// over - a live "users earned ₦X" counter would be a fabricated number on a
// public page, and an animated money figure is exactly the shape that lets a
// pending amount read as a credited one. So the numbers here animate, and the
// money-adjacent one is a percentage.
//
// THE TRUE VALUE IS ALWAYS IN THE DOM, EVEN MID-ANIMATION.
//
// The usual count-up implementation REWRITES the visible text from 0 upward, so
// for one and a half seconds the page asserts numbers that are not true - and a
// crawler, a screenshot, or a reader whose JS died mid-flight sees whatever the
// counter happened to be at that instant.
//
// So the animated digits are `aria-hidden` decoration and the CORRECT value
// lives in a sibling `sr-only` span that never changes. A screen reader, a
// crawler and a no-JS reader all get 15%; only the eye sees it count. The two
// are never required to agree at the same instant, which is what makes this
// honest rather than merely smooth.
//
// A number animating toward its true value is fine. A figure that passes
// through a FALSE one to get there is not, because for a moment it claims
// something untrue about money.

interface CounterProps {
  /** The real value. Rendered as text from the first paint. */
  value: number;
  /** Displayed with this many decimals. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Milliseconds. */
  duration?: number;
  className?: string;
}

/**
 * Drives an eased count-up, or jumps straight to the target.
 *
 * THE STATE IS `progress` IN [0, 1], NOT THE DISPLAYED NUMBER.
 *
 * An earlier version stored the interpolated amount and special-cased reduced
 * motion with `setDisplay(value)` inside the effect body - a synchronous
 * setState during render-adjacent work, which `react-hooks/set-state-in-effect`
 * correctly rejects. Storing progress instead means the reduced-motion path
 * needs no setState at all: it simply renders `value * 1`. The displayed figure
 * is DERIVED during render, so there is exactly one place where the two agree
 * and no effect has to reconcile them.
 *
 * `progress` starts at 0 on the server too. That is deliberate, and the
 * consequence is that the animated digits read "0" until hydration while the
 * TRUE value is carried in a sibling `sr-only` span. Initialising to the final
 * value instead looks better in isolation and is strictly worse in practice:
 * the server paints the answer, JS snaps it to zero, and the page visibly
 * un-renders itself.
 */
function useCountUpProgress(duration: number, enabled: boolean) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Reduced motion, a zero duration, or no rAF: `progress` stays 1 below via
    // the derived path, so there is nothing to schedule.
    if (!enabled || duration <= 0) return;

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const ratio = Math.min(1, elapsed / duration);

      // easeOutCubic: fast first, settling into the final value. A linear count
      // reads as mechanical; this reads as arriving.
      setProgress(1 - Math.pow(1 - ratio, 3));

      if (ratio < 1) {
        frame.current = requestAnimationFrame(tick);
      }
    };

    frame.current = requestAnimationFrame(tick);

    // Cancelling on unmount matters: a dangling rAF that calls setState on an
    // unmounted component is a leak, and four of these mount at once.
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [duration, enabled]);

  // The single reconciliation point: an unanimated counter is simply a
  // completed one.
  return enabled && duration > 0 ? progress : 1;
}

/**
 * Reads `prefers-reduced-motion` as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because
 * `matchMedia` IS an external system: it already has a subscribe/notify API
 * built in, and this hook was hand-rolling both. The effect version also called
 * `setState` synchronously on mount to seed the initial value, which is the
 * cascading-render pattern `react-hooks/set-state-in-effect` exists to catch.
 *
 * `getServerSnapshot` returns false so server and first client render agree;
 * a mismatch here would throw a hydration error, not just warn.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);

  return () => query.removeEventListener('change', onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches,
    // Server snapshot. Must match the first client render, so hydration does
    // not discard the tree.
    () => false,
  );
}

export function Counter({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1400,
  className,
}: CounterProps) {
  const prefersReduced = usePrefersReducedMotion();

  // `progress` is 1 immediately when motion is reduced, so the visible digits
  // ARE the final value on the very first paint for those users - no animation,
  // no flash, and nothing to reconcile.
  const progress = useCountUpProgress(duration, !prefersReduced);
  const current = value * progress;

  // The correct, fully-formatted value. Always present, never animated.
  const exact = `${prefix}${value.toFixed(decimals)}${suffix}`;
  const shown = `${prefix}${current.toFixed(decimals)}${suffix}`;

  return (
    <span className={className}>
      {/*
        The accessible name is the TRUE value, always. The visible digits are
        `aria-hidden` decoration mid-animation, so without this a screen reader
        would read out whatever the counter happened to be on that frame -
        "3%" when the figure is 15%.
      */}
      <span className="sr-only">{exact}</span>

      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

interface Metric {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  hint: string;
}

/**
 * The four guarantees, as figures.
 *
 * Data rather than JSX so the numbers cannot be transcribed twice into prose,
 * which is how a published rate ends up disagreeing with the code that charges
 * it.
 */
const METRICS: Metric[] = [
  {
    value: 15,
    suffix: '%',
    label: 'One published fee',
    hint: 'On withdrawals only, and shown as gross, fee and net before you confirm.',
  },
  {
    value: 2,
    label: 'Separate balances',
    hint: 'Earned rewards and your deposits are different kinds of money. They never merge.',
  },
  {
    value: 0,
    label: 'Auto-verified claims',
    hint: 'A self-attested completion can never set auto-verification. No browser confirms its own reward.',
  },
  {
    value: 100,
    suffix: '%',
    label: 'Human support',
    hint: 'Every reply is written by an authorised human agent. No automated system writes one.',
  },
];

export function TrustStrip() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {METRICS.map((metric) => (
        <li
          key={metric.label}
          className="rounded-card border border-ink-100 bg-surface p-4 shadow-card transition-shadow duration-200 ease-[var(--ease-out-expo)] hover:shadow-lift"
        >
          <p className="text-3xl font-bold tracking-tight text-brand-600 tabular-nums">
            <Counter
              value={metric.value}
              decimals={metric.decimals}
              prefix={metric.prefix}
              suffix={metric.suffix}
            />
          </p>

          <p className="mt-1.5 text-sm font-semibold text-ink-900">{metric.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{metric.hint}</p>
        </li>
      ))}
    </ul>
  );
}