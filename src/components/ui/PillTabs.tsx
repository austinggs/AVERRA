'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from './Card';
import { pillTabId, pillTabPanelId } from './pillTabIds';

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

/**
 * Whether arrowing onto a tab also selects it.
 *
 * `automatic` - focus moves AND the tab activates.
 * `manual`     - focus moves only; the user presses Enter or clicks.
 *
 * WHY THE DEFAULT IS DERIVED FROM THE ITEMS
 *
 * These are two different patterns and only one of them can be automatic.
 *
 * A tab that filters in place can afford automatic activation: arrowing past four
 * filters is free, and making the user press Enter after each arrow is the thing
 * APG is trying to avoid.
 *
 * A tab that is a LINK cannot. Activating one navigates, and a navigation per
 * arrow press means a server round trip, a scroll reset and a full page swap for
 * every arrow the user holds down. APG is explicit that automatic activation is
 * wrong when activating a tab costs a page load, and it is the reason this control
 * was wrong before it was inert: the comment claimed "automatic activation" while
 * the code could only ever move focus, because the earn page's tabs are links and
 * a link cannot be activated by focusing it.
 *
 * So a link-bearing group is MANUAL by default, which is also what every other
 * native link group does - a sidebar, a browser tab strip, a card carousel. Arrow
 * to highlight, Enter to go.
 */
export type PillTabsActivation = 'automatic' | 'manual';

interface PillTabsProps {
  items: ReadonlyArray<PillTabItem>;
  activeKey: string;
  ariaLabel: string;
  /** Optional. A linked tab navigates on its own and never calls this. */
  onSelect?: (key: string) => void;
  className?: string;
  /**
   * Base id used to wire tabs to their panels.
   *
   * When supplied, every tab gets an `id` and an `aria-controls` pointing at the
   * panel for that tab, and the panel itself gets the matching `id`. When
   * omitted, no ids are emitted at all.
   *
   * It is optional rather than required because a group with no tabpanel - a
   * filter bar above a table, say - has nothing to point at, and an
   * `aria-controls` naming a non-existent element is worse than none: assistive
   * technology reports a broken relationship instead of no relationship.
   */
  idPrefix?: string;
  /**
   * Overrides the derived default. Only needed to force `manual` on a purely
   * local group whose selection is expensive to recompute.
   */
  activation?: PillTabsActivation;
}

// The id helpers are NOT defined here.
//
// `pillTabId` and `pillTabPanelId` are exported from ./pillTabIds, which carries no
// 'use client' directive. A Server Component that imports them from THIS file
// receives client references, not functions, and throws the moment it calls one to
// build the panel's `aria-labelledby`: "Attempted to call pillTabPanelId() from the
// server but pillTabPanelId is on the client."
//
// Rendering a component across that boundary is legal and is the whole point of the
// App Router. CALLING a value across it is not. So do NOT move these two back here,
// and do NOT `export { pillTabId } from './pillTabIds'` to keep the old import
// path working: a re-export re-wraps them as client references and restores the
// trap exactly.
//
// `npm run check:server-imports` fails the build on a non-client module that imports
// a client-module export and calls it.

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
 *
 * Making it a link has a consequence for the keyboard model, and the two are not
 * separable. See `PillTabsActivation` below: a link cannot be activated by
 * focusing it, so this group is MANUAL by default and the arrow keys move focus
 * without navigating.
 */
export function PillTabs({
  items,
  activeKey,
  ariaLabel,
  onSelect,
  className,
  idPrefix,
  activation,
}: PillTabsProps) {
  const nodes = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

  // Derived, not declared: a caller should get the safe behaviour by forgetting
  // to think about it. See PillTabsActivation for why links cannot be automatic.
  const mode: PillTabsActivation =
    activation ?? (items.some((item) => item.href) ? 'manual' : 'automatic');

  /** Moves focus, wrapping in both directions. */
  function focusAt(index: number) {
    const count = items.length;
    if (count === 0) return;
    nodes.current[((index % count) + count) % count]?.focus();
  }

  /**
   * APG keyboard handling: arrows and Home/End move focus, wrapping.
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
        : Math.max(
            0,
            items.findIndex((item) => item.key === activeKey),
          );

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
    if (!target) return;

    // Only AUTOMATIC mode activates on focus. A linked group stops here, and
    // Enter or a click navigates - which is native link behaviour, and is why no
    // Space handling is added here: Space scrolls the page, and hijacking it
    // inside a group of links would break scrolling for keyboard users.
    if (mode !== 'automatic') return;
    if (target.key !== activeKey) onSelect?.(target.key);
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
          // Only emitted when the caller declared a panel to point at. See
          // `idPrefix`: an aria-controls naming nothing is a broken relationship,
          // and the panel renders in a different file from this component, so the
          // two ids must come from the same exported helpers.
          ...(idPrefix
            ? {
                id: pillTabId(idPrefix, item.key),
                'aria-controls': pillTabPanelId(idPrefix, item.key),
              }
            : {}),
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
          <button
            key={item.key}
            {...shared}
            ref={ref}
            type="button"
            onClick={() => onSelect?.(item.key)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
