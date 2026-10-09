import { PageSkeleton } from '@/components/ui/Skeleton';

// Dashboard loading state.
//
// The real title is derived from the user's display name ("Hello, Ada"), which
// cannot be known before the profile resolves. So the placeholder shows the
// generic "Dashboard" heading rather than a shimmer bar in the heading's place:
// a bar where the greeting will be tells the user nothing, and reading
// "Dashboard" tells them exactly where they are.
//
// The greeting is the first thing the user wants to see, so it is the one thing
// worth spending a real string on.
export default function Loading() {
  return <PageSkeleton title="Dashboard" cards={2} />;
}