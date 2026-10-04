'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './Card';

// Bottom tab navigation, matching the mobile-first register of the references.
//
// Icons are inline SVG rather than an icon package: the set is tiny, and this
// keeps the client bundle free of a dependency for six glyphs. Every icon is
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
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ items }: { items: TabItem[] }) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Primary"
      // Fixed on mobile, a row from md up. The register in the references is
      // mobile-first, so the bar is the default rather than an afterthought
      // squeezed beneath a desktop header.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-surface/95 backdrop-blur md:static md:inset-auto md:border-0 md:bg-transparent"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around md:max-w-3xl md:justify-start md:gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const count = item.badge ?? 0;

          return (
            <li key={item.href} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-pill px-2 py-1.5 text-[0.625rem] font-semibold transition-colors md:min-h-11 md:flex-row md:gap-2 md:px-3.5 md:text-sm',
                  active ? 'bg-brand-100 text-brand-800' : 'text-ink-500 hover:bg-ink-100',
                )}
              >
                <span className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-5"
                    aria-hidden="true"
                  >
                    {ICONS[item.icon]}
                  </svg>

                  {count > 0 ? (
                    <span className="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-brand-500 px-1 text-[0.5625rem] font-bold text-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : null}
                </span>

                {item.label}

                {/* Announced once as text. The visible badge alone would leave
                    the count as a shape with no accessible value. */}
                {count > 0 ? <span className="sr-only">, {count} unread</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
