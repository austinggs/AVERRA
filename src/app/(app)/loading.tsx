import { PageSkeleton } from '@/components/ui/Skeleton';

// Route-level loading state for the whole sessioned shell.
//
// WHY THIS IS HERE AND NOT PER-PAGE
//
// Every page in this group is a Server Component that awaits the database
// twice at least - the session, then the data. Without a `loading.tsx`, a
// navigation from one tab to another shows the previous page frozen and then
// snaps, and a COLD load shows a white screen with a spinning browser tab.
// Both read as "broken", and on a slow mobile connection the white screen can
// last several seconds.
//
// This file covers the entire group, so the behaviour is identical everywhere
// and no page can forget to opt in. A per-page override is still possible by
// adding a nearer `loading.tsx`, which is the right escape hatch for a route
// with an unusual shape - the wallet, for instance, is mostly two large
// balance cards rather than a list.
//
// WHAT IT MUST NOT DO
//
// It must not guess at the data. There is no placeholder figure, no sample
// balance and no "N/A" - a shimmer that briefly looked like a credited balance
// is the exact failure `MoneyState` exists to prevent. `PageSkeleton` reserves
// GEOMETRY only, and every skeleton block is `aria-hidden` with a single
// `role="status"` announcement beside it.
export default function Loading() {
  return <PageSkeleton />;
}