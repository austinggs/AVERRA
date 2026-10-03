import Link from 'next/link';
import { getUnreadNotificationCount } from '@/lib/notifications/service';
import { getSessionUser } from '@/lib/auth/session';
import { signOutAction } from '@/app/(auth)/auth-actions';
import { BottomNav, type TabItem } from '@/components/ui/BottomNav';

// Application shell (doc 09 navigation, doc 51 FRONTEND ARCHITECTURE).
//
// The shell is a Server Component. It reads the session and the unread count on
// the server, so the badge is rendered from authoritative data rather than
// hydrated optimistically from a client fetch.

const TABS: TabItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/earn', label: 'Earn', icon: 'earn' },
  { href: '/game', label: 'Game', icon: 'game' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/notifications', label: 'Alerts', icon: 'bell' },
  { href: '/referrals', label: 'Refer', icon: 'referral' },
  { href: '/support', label: 'Support', icon: 'help' },
];

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const unreadCount = user ? await getUnreadNotificationCount(user.id) : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-tile bg-brand-500 text-sm font-black text-white"
            >
              A
            </span>
            <span className="text-base font-bold tracking-tight text-ink-900">Averra</span>
          </Link>

          <div className="flex items-center gap-2">
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
          last line of content. */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 md:px-6 md:pb-12">
        {children}
      </main>

      <div className="md:border-t md:border-ink-100 md:bg-surface">
        <BottomNav
          items={TABS.map((tab) =>
            tab.href === '/notifications' ? { ...tab, badge: unreadCount } : tab,
          )}
        />
      </div>
    </div>
  );
}
