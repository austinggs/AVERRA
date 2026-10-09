import Link from 'next/link';
import { getUnreadNotificationCount } from '@/lib/notifications/service';
import { getSessionUser } from '@/lib/auth/session';
import { signOutAction } from '@/app/(auth)/auth-actions';
import { BottomNav, type TabItem } from '@/components/ui/BottomNav';
import { TopNav } from '@/components/ui/TopNav';
import { CORE_TABS, SECONDARY_TABS } from '@/components/ui/navItems';
import { BrandLockup } from '@/components/brand/BrandLockup';

// Application shell (doc 09 navigation, doc 51 FRONTEND ARCHITECTURE).
//
// The shell is a Server Component. It reads the session and the unread count on
// the server, so the badge is rendered from authoritative data rather than
// hydrated optimistically from a client fetch.
//
// Two navigations, one destination list:
//   - TopNav lives in the STICKY header and is visible from `md` up, so
//     desktop users navigate from a bar that is always on screen.
//   - BottomNav is mobile-only (< md): six core tabs plus a "More" sheet,
//     because nine tabs in one row broke the 44px tap rule at 320-375px.
// The destination arrays live in navItems.ts; tests/ui/navigation.test.tsx
// asserts the split, and both navs share the icon/badge primitives so they
// cannot drift apart.

function withBadge(tabs: TabItem[], unreadCount: number): TabItem[] {
  return tabs.map((tab) => (tab.href === '/notifications' ? { ...tab, badge: unreadCount } : tab));
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const unreadCount = user ? await getUnreadNotificationCount(user.id) : 0;

  const coreTabs = withBadge(CORE_TABS, unreadCount);
  const secondaryTabs = withBadge(SECONDARY_TABS, unreadCount);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-canvas/90 backdrop-blur">
        {/* The header widens at lg so the top nav fits beside the logo and
            the session actions (labelled from xl: nine labelled items need
            ~870px, which max-w-6xl cannot give them next to logo + actions).
            Main stays max-w-3xl - content measure and navigation chrome are
            different constraints. */}
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 md:px-6 lg:max-w-7xl">
          <BrandLockup href="/dashboard" className="shrink-0" />

          <TopNav items={[...coreTabs, ...secondaryTabs]} />

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/settings"
              className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Settings
            </Link>

            <form action={signOutAction}>
              <button
                type="submit"
                className="min-h-10 rounded-pill px-3 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Extra bottom padding on mobile so the fixed tab bar never covers the
          last line of content. There is no fixed bar from md up, so the
          desktop padding is the modest one. */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 md:px-6 md:pb-12">
        {children}
      </main>

      {/* Mobile only; the nav itself also carries md:hidden. The old wrapper
          rendered this element as a static footer row on desktop, which meant
          navigating required scrolling to the bottom of the page. */}
      <BottomNav core={coreTabs} secondary={secondaryTabs} />
    </div>
  );
}
