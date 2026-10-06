'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './Card';
import { NavBadge, NavIcon, isActive, type TabItem } from './BottomNav';

// Top navigation, rendered inside the sticky header from `md` up - the
// desktop/tablet counterpart to the mobile-only BottomNav. Before this
// existed, the md:static bottom bar was the ONLY navigation on desktop and
// you had to scroll to the bottom of every page to change section.
//
// The header is the one element that is always on screen, so navigation now
// travels with the user at every viewport.
//
// Breakpoint behaviour of the labels:
//   - md - lg: icon-only pills (nine labelled items do not fit beside the
//     logo and the session actions at these widths). Each link keeps an
//     accessible name through its text label and a native tooltip via
//     `title`, so icon-only is a visual decision, not an a11y one.
//   - xl+: labels shown; the header widens to max-w-7xl at lg+ in the layout
//     to make room (nine labelled items need ~870px beside the logo and the
//     session actions).
export function TopNav({ items }: { items: TabItem[] }) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Primary"
      className="hidden min-w-0 flex-1 items-center justify-center md:flex"
    >
      <ul className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const count = item.badge ?? 0;

          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                className={cx(
                  'flex min-h-11 items-center gap-2 rounded-pill px-2.5 text-sm font-medium transition-colors xl:px-3.5',
                  active ? 'bg-brand-100 text-brand-800' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
                )}
              >
                <span className="relative">
                  <NavIcon icon={item.icon} />
                  <NavBadge count={count} />
                </span>

                <span className="hidden whitespace-nowrap xl:inline">{item.label}</span>

                {count > 0 ? <span className="sr-only">, {count} unread</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
