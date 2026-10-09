import { PageSkeleton } from '@/components/ui/Skeleton';

// Wallet loading state.
//
// This page has a genuinely different shape from the rest of the shell: it is
// dominated by two large balance CARDS, not a list of rows. The group-level
// skeleton would reserve list geometry and then have the real page reflow into
// cards, which is worse than showing nothing deliberate - the content jumps
// exactly where the user is most likely to be looking.
//
// WHY THE BLOCKS ARE NEUTRAL AND NOT GREEN
//
// The obvious thing to do here is tint the balance placeholders brand-green,
// because that is the colour of the number they are standing in for. That would
// be the one place this design system lied about money: a shimmer that briefly
// reads as a credited balance is precisely what `MoneyState` exists to prevent,
// and a user who catches a green block mid-load has been shown a pending
// figure as though it were available.
//
// So these are plain neutral blocks. The COLOUR arrives with the data, and only
// when the data says so.
export default function Loading() {
  return <PageSkeleton title="Wallet" cards={2} />;
}