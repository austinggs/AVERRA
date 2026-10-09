import type { ComponentProps } from 'react';
import { cx } from './Card';

// Loading placeholders.
//
// WHY THIS FILE EXISTS AT ALL
//
// Every page in this application is a Server Component that awaits the
// database. Until one returns, Next has literally nothing to paint, so the
// browser holds the previous frame - or, on a cold navigation, a blank white
// screen with a spinning tab. That reads to a user as "the site is broken",
// and on a mobile connection it can be the whole first impression.
//
// A skeleton fixes that by fixing the LAYOUT in advance. The shapes below are
// deliberately the same geometry as the content that replaces them
// (card padding, radius, title/row rhythm), so the swap does not move.
//
// THREE RULES, EACH LEARNED THE HARD WAY
//
// 1. A skeleton is NEVER a spinner over a spinner, and never a blank panel.
//    An indeterminate bar communicates "something is happening"; a block of
//    the right shape communicates "something is happening AND it will look
//    like this". The second is worth more.
//
// 2. Skeletons must be hidden from assistive technology, or a screen reader
//    announces a page of blank boxes. Every primitive below carries
//    `aria-hidden` and the wrapper carries the single live-region status.
//
// 3. SKELETONS CARRY NO FINANCIAL STATE. There is deliberately no skeleton
//    with a green accent, and no `MoneyState`-shaped placeholder. A shimmer
//    that briefly looked like a credited balance would be the one place this
//    design system lied about money, which is precisely the failure the whole
//    MoneyState component exists to prevent.

function Block({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cx('skeleton rounded-tile', className)}
      {...rest}
    />
  );
}

interface SkeletonTextProps {
  /** How many lines to reserve. */
  lines?: number;
  className?: string;
}

/**
 * Placeholder body copy.
 *
 * The last line is shortened, because a stack of identical full-width bars
 * reads as a rendering bug rather than as text.
 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const count = Math.max(1, lines);

  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: count }, (_, index) => (
        <Block
          key={index}
          className={cx('h-3', index === count - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
}

/** A card-shaped placeholder matching `Card`'s padding and radius exactly. */
export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={cx('rounded-card border border-ink-100 bg-surface p-5 shadow-card', className)}
    >
      <Block className="h-4 w-2/5" />
      <SkeletonText lines={2} className="mt-3" />
    </div>
  );
}

/** A list of card-shaped placeholders. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

/**
 * The page-level loading state.
 *
 * `role="status"` with a real text label is the whole accessibility contract:
 * a sighted user reads the shape, a screen-reader user hears "Loading…", and
 * the label is inside `aria-live` so it is announced when the route resolves.
 */
export function PageSkeleton({
  title,
  cards = 3,
  description = true,
}: {
  /** The real heading text, so the frame does not reflow when it is replaced. */
  title?: string;
  cards?: number;
  description?: boolean;
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="pt-6 pb-2">
        {/*
          The heading is REAL TEXT when the caller supplies it, never a
          skeleton. An earlier version passed `sr-only` into the Block so a
          supplied title would be "hidden" - which still leaves an animated
          element in the accessibility tree doing nothing, and replaces
          readable copy with a placeholder bar. Real text is better on both
          counts: it is announced, and it means the heading is legible even in
          the frame that loads it.
        */}
        {title ? (
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        ) : (
          <Block className="h-7 w-48" />
        )}

        {description ? (
          <Block className="mt-3.5 h-3.5 w-72 max-w-full" />
        ) : null}
      </div>

      <SkeletonList count={cards} />
    </div>
  );
}