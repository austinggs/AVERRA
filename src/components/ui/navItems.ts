import type { TabItem } from './BottomNav';

// The navigation split, as data.
//
// Nine destinations in one row broke the design-system tap rule: at a 320px
// viewport nine tabs work out to ~35px each, and every interactive element must
// be at least 44px. Six primary tabs give ~53px each at 320px, and the rest
// live behind a "More" sheet on mobile.
//
// Desktop is the mirror image of that constraint: the sticky header has room
// for every destination, so TopNav renders CORE + SECONDARY in full and the
// bottom bar is hidden from `md` up.
//
// Keep the two arrays disjoint - a destination in both would render twice in
// the bottom bar and once in the sheet. tests/ui/navigation.test.tsx asserts
// the split, so a silent change here fails a named test.

/** The six destinations always visible in the mobile bottom bar. */
export const CORE_TABS: TabItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/earn', label: 'Earn', icon: 'earn' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '/game', label: 'Game', icon: 'game' },
  { href: '/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/notifications', label: 'Alerts', icon: 'bell' },
];

/** Destinations behind "More" on mobile; shown in full in the desktop header. */
export const SECONDARY_TABS: TabItem[] = [
  { href: '/referrals', label: 'Refer', icon: 'referral' },
  { href: '/perks', label: 'Perks', icon: 'sparkles' },
  { href: '/support', label: 'Support', icon: 'help' },
];

/** Every destination, in header order. */
export const ALL_TABS: TabItem[] = [...CORE_TABS, ...SECONDARY_TABS];
