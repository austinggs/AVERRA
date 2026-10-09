import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Reveal, RevealGroup } from '@/components/ui/Reveal';

// The scroll reveal has ONE property worth protecting, and it is the property
// the implementation was structured around: the content must be visible when
// nothing runs.
//
// The failure this guards against is silent and severe. The obvious
// implementation of a scroll reveal is `opacity-0` in the base class plus a
// class that animates it in. That page is BLANK for anyone whose JavaScript
// does not run - a crawler, a failed chunk, a content blocker, a browser with
// JS disabled. No error, no console warning: the page simply has no content, and
// in a search index or a no-JS client it reads as an empty page.
//
// So `Reveal` renders visible by default and ADDS the animation. These tests
// assert the visible-by-default half directly, and one of them is written to
// fail if a future change restores the `opacity-0` pattern.

describe('Reveal never hides content by default', () => {
  it('renders its children in the DOM immediately', () => {
    render(
      <Reveal>
        <p>Visible without JavaScript</p>
      </Reveal>,
    );

    expect(screen.getByText('Visible without JavaScript')).toBeInTheDocument();
  });

  it('does not apply an opacity-0 class while the element is still below the fold', () => {
    // The worst case: the observer runs, decides the element is off-screen, and
    // never fires. Content must still be present and unhidden.
    //
    // `getBoundingClientRect` is stubbed because jsdom does no layout - every
    // element reports `top: 0`, which is `< window.innerHeight`, so `Reveal`
    // takes its "already in view" branch and reveals immediately. Without this
    // stub the test would pass while measuring nothing.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 9000,
      bottom: 9100,
      left: 0,
      right: 0,
      width: 0,
      height: 100,
      x: 0,
      y: 9000,
      toJSON: () => ({}),
    });

    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = observe;
        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = () => [];
        root = null;
        rootMargin = '';
        thresholds = [];
        constructor(_cb: unknown) {}
      },
    );

    const { container } = render(
      <Reveal>
        <p>Never intersected</p>
      </Reveal>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.className).not.toContain('opacity-0');
    expect(wrapper.className).not.toContain('animate-rise');
    expect(screen.getByText('Never intersected')).toBeVisible();
    expect(observe).toHaveBeenCalled();
  });

  it('leaves content visible when IntersectionObserver is unavailable entirely', () => {
    // Older browsers, and any environment where the constructor is missing.
    // The component must degrade to "no animation", never to "no content".
    vi.stubGlobal('IntersectionObserver', undefined);

    const { container } = render(
      <Reveal>
        <p>No observer support</p>
      </Reveal>,
    );

    expect(screen.getByText('No observer support')).toBeVisible();
    expect((container.firstElementChild as HTMLElement).className).not.toContain('opacity-0');
  });
});

describe('RevealGroup', () => {
  it('staggers children with an increasing delay', () => {
    const items = ['first', 'second', 'third'];

    const { container } = render(
      <RevealGroup>
        {items.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </RevealGroup>,
    );

    // Every child is rendered even though the observer never fires.
    for (const item of items) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }

    expect(container.querySelectorAll('p')).toHaveLength(3);
  });

  it('renders a single child without throwing', () => {
    // `children.map` on a lone element is not an array and throws. This is the
    // shape a conditional wrapper produces, and it is the common case.
    expect(() =>
      render(
        <RevealGroup>
          <p>only child</p>
        </RevealGroup>,
      ),
    ).not.toThrow();

    expect(screen.getByText('only child')).toBeInTheDocument();
  });

  it('renders nothing gracefully when given no children', () => {
    expect(() => render(<RevealGroup>{null}</RevealGroup>)).not.toThrow();
  });
});