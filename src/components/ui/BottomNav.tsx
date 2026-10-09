'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cx } from './Card';

// Bottom tab navigation, matching the mobile-first register of the references.
//
// RESPONSIVE SPLIT: this component is now MOBILE ONLY (`md:hidden` on the
// nav itself).
//   - < md: fixed bottom bar with the six CORE tabs plus a "More" sheet.
//     Nine tabs in one row failed the 44px tap rule at 320-375px (~35px each);
//     six tabs give ~53px each even at a 320px viewport.
//   - >= md: hidden entirely. TopNav in the sticky header carries every
//     destination, so navigation no longer means scrolling to the page bottom.
//
// The "More" sheet is a modal dialog: Escape closes it, the backdrop closes
// it, focus is trapped while open and returns to the trigger on close, and
// body scroll is locked. The slide-up animation is disabled by the global
// prefers-reduced-motion rule in globals.css, so the sheet is equally usable
// with animations off.
//
// Icons are inline SVG rather than an icon package: the set is tiny, and this
// keeps the client bundle free of a dependency for nine glyphs. Every icon is
// aria-hidden because the label beside it already names the destination.

export interface TabItem {
  href: string;
  label: string;
  icon: 'home' | 'earn' | 'game' | 'tasks' | 'wallet' | 'bell' | 'referral' | 'sparkles' | 'help';
  /** Optional count badge, e.g. unread notifications. */
  badge?: number;
}

const ICONS: Record<TabItem['icon'], React.ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1h3.5v-5.5h4.5V21h3.5a1 1 0 0 0 1-1V9.75" />
  ),
  earn: (
    <path d="M12 3v18M16.5 7.5c0-1.66-2.01-3-4.5-3S7.5 5.84 7.5 7.5 9.51 10.5 12 10.5s4.5 1.34 4.5 3-2.01 3-4.5 3-4.5-1.34-4.5-3" />
  ),
  game: (
    <path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.7 3a2.5 2.5 0 0 1-4.5.9L15.5 16h-7l-1.2 1.3a2.5 2.5 0 0 1-4.5-.9l-.7-3A4.5 4.5 0 0 1 6.5 8Z M8 11v2.5M6.75 12.25h2.5M15.5 11.5h.01M17.5 13.5h.01" />
  ),
  tasks: (
    <path d="M9 5h9M9 12h9M9 19h9M4.5 5.5 5.5 6.5 7.5 4.5M4.5 12.5 5.5 13.5 7.5 11.5M4.5 19.5 5.5 20.5 7.5 18.5" />
  ),
  wallet: (
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2m-15 0v9a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-15Z" />
  ),
  bell: (
    <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0 0 12 3Zm-2 14a2 2 0 0 0 4 0" />
  ),
  referral: (
    <path d="M16.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20M10 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM20.5 20v-1.5a3.5 3.5 0 0 0-2.625-3.386M16.25 4.114a3.75 3.75 0 0 1 0 7.272" />
  ),
  sparkles: (
    <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8 12 3.5ZM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
  ),
  help: (
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-1.5-13.5a1.6 1.6 0 1 1 2.3 1.45c-.6.3-.8.7-.8 1.3v.25m0 3.5h.01" />
  ),
};

/** A path is active for itself and for anything nested beneath it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The tab glyph. Shared by BottomNav and TopNav so the two navs cannot drift. */
export function NavIcon({ icon, className }: { icon: TabItem['icon']; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('size-5', className)}
      aria-hidden="true"
    >
      {ICONS[icon]}
    </svg>
  );
}

/**
 * The count badge over an icon.
 *
 * The caller also renders an sr-only sentence: the visible badge alone would
 * leave the count as a shape with no accessible value.
 */
export function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-brand-500 px-1 text-[0.5625rem] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * The bar's shared item geometry, used by BOTH a tab link and the "More"
 * trigger.
 *
 * One definition rather than two, because the trigger used to carry its own
 * inline copy of these classes and the two drifted: the trigger was still on
 * `transition-colors` with no press feedback while the tabs gained it. A "More"
 * button that behaves differently from every other item in the same bar reads
 * as a broken control rather than as a special one.
 *
 * Two things make the bar feel like a physical control rather than a list of
 * links:
 *
 *   1. `active:scale-95` on press. Without a depress, tapping a bottom tab on a
 *      phone gives no immediate acknowledgement - the page has not navigated
 *      yet and nothing has changed, so the tap reads as ignored.
 *
 *   2. The transition is scoped to transform, colour and background. A blanket
 *      `transition-all` animates the width change that happens when the active
 *      pill gains a background, which smears the bar as you move between tabs.
 *
 * `min-h-14` is 56px, comfortably above the 44px tap rule, and the label is
 * `text-[0.625rem]` because a 10px label is the largest that still fits beside
 * the icon at a 320px viewport with six tabs.
 */
const TAB_ITEM_CLASS =
  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 py-1.5 ' +
  'text-[0.625rem] font-semibold transition-[transform,color,background-color] ' +
  'duration-200 ease-[var(--ease-out-expo)] active:scale-95';

const SHEET_LINK_CLASS =
  'flex min-h-12 items-center gap-3 rounded-tile px-3 text-sm font-medium ' +
  'transition-colors duration-200 active:scale-[0.98]';

interface BottomNavProps {
  /** The six always-visible tabs. */
  core: TabItem[];
  /** Tabs behind the "More" sheet. An empty array renders no trigger. */
  secondary: TabItem[];
}

export function BottomNav({ core, secondary }: BottomNavProps) {
  const pathname = usePathname() ?? '';
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close the sheet when the route changes - the case this catches is the
  // browser Back button while the sheet is open. Adjusted during render
  // (the React-documented "storing information from previous renders"
  // pattern) rather than in an effect, which would be a cascading render.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (sheetOpen) setSheetOpen(false);
  }

  // Modal behaviour while open: Escape, focus trap, and scroll lock.
  useEffect(() => {
    if (!sheetOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSheetOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>('a[href], button');
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === sheetRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sheetOpen]);

  const closeSheet = (restoreFocus: boolean) => {
    setSheetOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const secondaryActive = secondary.some((item) => isActive(pathname, item.href));
  const secondaryBadge = secondary.reduce((total, item) => total + (item.badge ?? 0), 0);

  return (
    <nav
      aria-label="Primary"
      // Fixed to the bottom on mobile only. From md up this element is hidden
      // and TopNav in the header carries the same destinations, so there is
      // never a moment with no visible navigation.
      // FIXED TO THE BOTTOM ON MOBILE ONLY. From `md` up this element is hidden
      // and TopNav in the sticky header carries the same destinations, so there is
      // never a moment with no visible navigation.
      //
      // THE SAFE-AREA INSET IS THE POINT OF THE PADDING BLOCK.
      //
      // `padding-bottom: env(safe-area-inset-bottom)` lifts the bar clear of the
      // home indicator on an iPhone. Without it the bar sits flush against the
      // indicator and its lower edge is inside the gesture area - so a tap aimed
      // at the bottom of "Wallet" is swallowed by the system, and the tap appears
      // to do nothing. That is not a cosmetic defect on the primary navigation;
      // it is a control that intermittently fails.
      //
      // `max()` is required, not optional: on a device with no inset (every
      // Android phone, desktop) `env()` resolves to 0px and plain `env()` would
      // collapse the bar's bottom padding to nothing, making it visibly shorter
      // than intended on the majority of devices.
      // `shadow-pop` is the deepest elevation in the scale and belongs to this bar
      // and the More sheet: both are genuinely floating above page content. A
      // shadow that is not monotonic becomes decoration, and then nothing reads
      // as "on top".
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-surface/95 shadow-pop backdrop-blur md:hidden"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {core.map((item) => {
          const active = isActive(pathname, item.href);
          const count = item.badge ?? 0;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  TAB_ITEM_CLASS,
                  'w-full',
                  active ? 'bg-brand-100 text-brand-800' : 'text-ink-500 hover:bg-ink-100',
                )}
              >
                <span className="relative">
                  <NavIcon icon={item.icon} />
                  <NavBadge count={count} />
                </span>

                {item.label}

                {/* Announced once as text. The visible badge alone would leave
                    the count as a shape with no accessible value. */}
                {count > 0 ? <span className="sr-only">, {count} unread</span> : null}
              </Link>
            </li>
          );
        })}

        {secondary.length > 0 ? (
          <li className="flex-1">
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={sheetOpen}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen((open) => !open)}
              className={cx(
                TAB_ITEM_CLASS,
                'w-full',
                secondaryActive || sheetOpen
                  ? 'bg-brand-100 text-brand-800'
                  : 'text-ink-500 hover:bg-ink-100',
              )}
            >
              <span className="relative">
                {/* Three dots: the universal affordance for "there is more". */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  className="size-5"
                  aria-hidden="true"
                >
                  <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
                </svg>
                <NavBadge count={secondaryBadge} />
              </span>

              More
              {secondaryBadge > 0 ? (
                <span className="sr-only">, {secondaryBadge} unread</span>
              ) : null}
            </button>
          </li>
        ) : null}
      </ul>

      {sheetOpen ? (
        // Backdrop: a click anywhere outside the sheet dismisses it. The sheet
        // itself stops propagation so tapping a row is never a misclick-close.
        <div className="fixed inset-0 z-50" role="presentation" onClick={() => closeSheet(false)}>
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]" />

          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            className="nav-sheet absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-ink-200 bg-surface p-3 pb-6 shadow-raised focus:outline-none"
          >
            {/* Drag-handle, decorative: the sheet is dismissed by backdrop,
                Escape or a row - never by a swipe-only gesture. */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-pill bg-ink-200" aria-hidden="true" />

            <ul className="space-y-1">
              {secondary.map((item) => {
                const active = isActive(pathname, item.href);
                const count = item.badge ?? 0;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => closeSheet(false)}
                      className={cx(
                        SHEET_LINK_CLASS,
                        active ? 'bg-brand-100 text-brand-800' : 'text-ink-700 hover:bg-ink-100',
                      )}
                    >
                      <span className="relative">
                        <NavIcon icon={item.icon} />
                        <NavBadge count={count} />
                      </span>

                      {item.label}

                      {count > 0 ? <span className="sr-only">, {count} unread</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={() => closeSheet(true)}
              className="mt-3 min-h-11 w-full rounded-pill bg-ink-100 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-200"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
