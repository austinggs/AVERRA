'use client';

import { Children, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cx } from './Card';

// Scroll-triggered entrance.
//
// THE ONE PROPERTY THAT MATTERS: CONTENT IS NEVER HIDDEN BY DEFAULT.
//
// The obvious implementation is `opacity: 0` in the base class, then a class
// that animates it in once the element intersects. That is a page that is
// blank for anyone whose JavaScript never runs - a crawler, a failed chunk, a
// script-blocked browser, or a user who arrived on `#section-3` and never
// scrolled the sections above it into view.
//
// So this inverts it. The element is fully visible in its base state, and the
// ANIMATION is what gets added, via `animate-rise`, once the element is known
// to be on screen. If the observer never fires, the worst case is "no
// animation" - which is exactly what `prefers-reduced-motion` asks for
// anyway. The failure mode and the accessibility preference are the same
// outcome, which is the property worth designing for.
//
// `animate-rise` uses `both` fill mode, so `from` (opacity 0) applies during
// the animation's own delay window too, and there is no flash of the final
// state before the animation starts.

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

/** Per-direction start offsets, as CSS custom properties. */
const OFFSET: Record<Exclude<RevealDirection, 'none'>, string> = {
  up: '--reveal-y: 16px; --reveal-x: 0px',
  down: '--reveal-y: -16px; --reveal-x: 0px',
  left: '--reveal-y: 0px; --reveal-x: 24px',
  right: '--reveal-y: 0px; --reveal-x: -24px',
};

interface RevealProps {
  children: ReactNode;
  /** Seconds to wait before revealing. Used to stagger a group of siblings. */
  delay?: number;
  direction?: RevealDirection;
  className?: string;
  as?: ElementType;
}

/**
 * Fades and lifts its children into place the first time they scroll into view.
 *
 * Rendered as a `div` by default. `as` exists so a reveal can wrap a heading
 * or a list item without introducing a meaningless extra `div` into the
 * document outline - the same reasoning as `Card`'s `as` prop.
 */
export function Reveal({
  children,
  delay = 0,
  direction = 'up',
  className,
  as: Tag = 'div',
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;

    // No ref, or nothing to observe. Stay un-animated; the content is already
    // visible, which is the entire point of the base state.
    if (!node || typeof IntersectionObserver === 'undefined') return;

    // Already in view on mount (a short page, or a deep link) - reveal
    // immediately rather than waiting for a scroll that may never happen.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            // One-shot by design. Unobserving means a user scrolling back up
            // does not replay the animation, which is noise on a page they
            // have already read.
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={
        shown && direction !== 'none'
          ? {
              ...(delay ? { animationDelay: `${delay}s` } : {}),
              // Custom properties, not `transform`: the keyframe owns the
              // transform, and setting it inline would override the animation
              // entirely.
              ...parseOffset(OFFSET[direction]),
            } as React.CSSProperties
          : undefined
      }
      className={cx(shown && direction !== 'none' && 'animate-rise', className)}
    >
      {children}
    </Tag>
  );
}

/** Turns `"--reveal-y: 16px; --reveal-x: 0px"` into a typed style object. */
function parseOffset(source: string): React.CSSProperties {
  const style: Record<string, string> = {};

  for (const declaration of source.split(';')) {
    const [property, value] = declaration.split(':');
    if (property && value) style[property.trim()] = value.trim();
  }

  return style as React.CSSProperties;
}

/**
 * Staggered container: applies a cumulative delay to each direct `Reveal`
 * child so a group arrives in sequence instead of all at once.
 *
 * The delay is passed as a PROP rather than read from a CSS variable because
 * `animation-delay` on the PARENT does not cascade to a child that has its own
 * animation - each child needs its own value.
 */
export function RevealGroup({
  children,
  step = 0.06,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  step?: number;
  className?: string;
  as?: ElementType;
}) {
  // `Children.toArray` rather than `children.map`: a single child is a bare
  // element, not an array, and `.map` on it throws. The array form made a
  // one-item group a runtime crash rather than a no-op.
  const items = Children.toArray(children);

  return (
    <Tag className={className}>
      {items.map((child, index) => (
        <Reveal key={index} delay={index * step}>
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}