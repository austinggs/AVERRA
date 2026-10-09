import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageSkeleton, SkeletonCard, SkeletonText } from '@/components/ui/Skeleton';

// Loading placeholders.
//
// THE TWO INVARIANTS, BOTH OF WHICH ARE ABOUT LYING TO A USER
//
// 1. Skeletons reserve GEOMETRY and never assert a value. A placeholder that
//    rendered "0" or a sample balance would be indistinguishable from real data
//    for as long as it was on screen. There is deliberately no
//    `MoneyState`-shaped placeholder in this design system.
//
// 2. Skeletons are invisible to assistive technology apart from ONE live region.
//    A screen reader announcing a page of blank boxes is worse than announcing
//    nothing, and eleven separate announcements is worse still.
//
// Both are asserted rather than assumed, because both were violated by earlier
// drafts of `PageSkeleton` - one passed `sr-only` into a shimmer block, which
// left an animated element in the accessibility tree doing nothing.

describe('Skeleton primitives are hidden from assistive technology', () => {
  it('marks every placeholder block aria-hidden', () => {
    const { container } = render(<SkeletonCard />);

    const blocks = container.querySelectorAll('.skeleton');
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      expect(block).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders no text content at all in a bare card', () => {
    const { container } = render(<SkeletonCard />);

    // A placeholder that renders readable text is a placeholder that has started
    // making claims. There must be nothing to read.
    expect(container.textContent?.trim()).toBe('');
  });

  it('shortens the final line of a text skeleton', () => {
    const { container } = render(<SkeletonText lines={3} />);

    const rows = Array.from(container.querySelectorAll('.skeleton'));
    expect(rows).toHaveLength(3);

    // `at()` rather than `[n]`: with `noUncheckedIndexedAccess` on, `rows[2]` is
    // `Element | undefined` and the assertion would need a non-null assertion
    // that could itself throw before reaching the check.
    expect(rows.at(-1)?.className).toContain('w-3/5');
    expect(rows.at(0)?.className).toContain('w-full');
  });

  it('always renders at least one line', () => {
    const { container } = render(<SkeletonText lines={0} />);

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });
});

describe('PageSkeleton announces exactly one loading state', () => {
  it('exposes a single polite live region with a real label', () => {
    render(<PageSkeleton />);

    const status = screen.getByRole('status');

    expect(status).toHaveAttribute('aria-live', 'polite');
    // The label is what a screen reader actually says. A spinner with no text is
    // silence.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the supplied heading as TEXT, not as a placeholder bar', () => {
    render(<PageSkeleton title="Wallet" />);

    // The heading is real text so it is legible and announced even in the frame
    // that only exists while loading. An earlier version passed `sr-only` into
    // the skeleton block, which hid nothing useful and animated a heading that
    // was already hidden.
    const heading = screen.getByRole('heading', { name: 'Wallet' });
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveClass('skeleton');
  });

  it('falls back to a placeholder bar when no heading is supplied', () => {
    const { container } = render(<PageSkeleton />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('renders no heading element at all inside a bare skeleton', () => {
    // Guards against a placeholder that quietly becomes an empty <h1>, which is
    // an outline entry announcing nothing.
    const { container } = render(<PageSkeleton />);

    expect(container.querySelector('h1')).toBeNull();
  });

  it('reserves one card per requested count', () => {
    const { container } = render(<PageSkeleton cards={4} />);

    // Reported against the population, so a filter matching nothing would be
    // visible rather than looking like a correct zero.
    const cards = Array.from(container.querySelectorAll('.rounded-card'));
    expect(cards).toHaveLength(4);
  });
});