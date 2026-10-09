'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from './Card';

// WHY THIS COMPONENT IS A SEPARATE CLIENT FILE
//
// It is the only piece of the segmented control that needs an event handler, and
// the page that renders it is a Server Component. Keeping it beside `Button`
// would have put `'use client'` on Button and ButtonLink too, pushing them into
// the client bundle at every call site in the application for one tab group.
//
// WHY EACH ITEM CARRIES ITS OWN href
//
// The obvious API is a `hrefFor(key)` callback. That cannot work here: props
// crossing from a Server Component to a Client Component must be serialisable,
// and a function is not. The failure would not be a type error - the prop type
// would be perfectly valid - it would be a runtime serialization error the
// moment a Server Component passed it. So the destination travels as data.

export interface PillTabItem {
  key: string;
  label: string;
  count?: number;
  /** When present the tab renders as a real link. */
  href?: string;
}

interface PillTabsProps {
  items: ReadonlyArray<PillTabItem>;
  activeKey: string;
  ariaLabel: string;
  /** Optional. A linked tab navigates on its own and never calls this. */
  onSelect?: (key: string) => void;
  className?: string;
}

/**
 * Segmented pill control, the filter language used across the references.
 *
 * WHY THIS WAS INERT
 *
 * It shipped as `<button role="tab">` with no handler, no href and no form,
 * while the page decided the active tab from `searchParams.tab`. Nothing on the
 * client could change the URL the server reads, so every tab did nothing - with
 * no error, and with the appearance of a working control.
 *
 * A tab here is therefore a LINK first and a button second. A link works before
 * JavaScript runs, supports middle-click and open-in-new-tab, and is crawlable;
 * a handler-only tab fails all three at once while looking correct.
 */
export function PillTabs({ items, activeKey, ariaLabel, onSelect, className }: PillTabsProps) {
  const nodes = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

  /** Moves focus, wrapping in both directions. */
  function focusAt(index: number) {
    const count = items.length;
    if (count === 0) return;
    nodes.current[((index % count) + count) % count]?.focus();
  }

  /**
   * APG automatic activation: arrowing onto another tab both moves focus and
   * selects it, so the user does not also have to press Enter.
   *
   * The origin is the FOCUSED tab, not `activeKey`. `activeKey` is server state
   * read from the URL, so between a keypress and the navigation it resolves, it is
   * stale. Using it would make a second rapid ArrowRight resolve from the old
   * origin and land on the same tab again - the key would look unresponsive.
   *
   * `event.target`, not `event.currentTarget`: the handler is attached to the
   * wrapping tablist, and React sets `currentTarget` to the element a listener is
   * bound to. That is the div, for every keypress, so it can never identify which
   * tab fired. `target` is the element the key actually came from.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const focused = nodes.current.indexOf(event.target as HTMLAnchorElement);
    const from =
      focused >= 0
        ? focused
        : Math.max(0, items.findIndex((item) => item.key === activeKey));

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = from + 1;
        break;
      case 'ArrowLeft':
        next = from - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        // Unhandled keys fall through to the browser. Notably ArrowUp/ArrowDown,
        // which must keep scrolling the page rather than being swallowed here.
        return;
    }

    event.preventDefault();
    focusAt(next);

    const target = items[((next % items.length) + items.length) % items.length];
    if (target && target.key !== activeKey) onSelect?.(target.key);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cx(
        'flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.key === activeKey;

        const shared = {
          role: 'tab' as const,
          'aria-selected': active,
          // Roving tabIndex: the whole group is ONE tab stop, and arrows move
          // within it. Without this a three-tab row costs three Tab presses.
          tabIndex: active ? 0 : -1,
          className: cx(
            // min-h-11 is 44px, the project's minimum tap target. This was
            // min-h-10 (40px), under the rule the design system states for every
            // interactive element.
            'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-semibold transition-colors',
            active
              ? 'bg-brand-500 text-white shadow-tile'
              : 'bg-surface text-ink-500 border border-ink-200 hover:bg-surface-sunken',
          ),
          style: { outlineOffset: '2px' },
        };

        const label = (
          <>
            {item.label}
            {item.count !== undefined ? (
              <span className={cx('text-xs', active ? 'text-white/80' : 'text-ink-400')}>
                {item.count}
              </span>
            ) : null}
          </>
        );

        const ref = (node: HTMLAnchorElement | HTMLButtonElement | null) => {
          nodes.current[index] = node;
        };

        return item.href ? (
          <Link key={item.key} {...shared} ref={ref} href={item.href}>
            {label}
          </Link>
        ) : (
          <button key={item.key} {...shared} ref={ref} type="button" onClick={() => onSelect?.(item.key)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}