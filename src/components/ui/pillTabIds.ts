// WHY THESE LIVE HERE AND NOT IN PillTabs.tsx
//
// `PillTabs.tsx` is a `'use client'` module. In the App Router, a non-component
// value imported from a `'use client'` module into a Server Component is a CLIENT
// REFERENCE - a proxy object, not a function. Rendering it as `<PillTabs />` is
// legal; CALLING it throws at render time:
//
//   Attempted to call pillTabPanelId() from the server but pillTabPanelId is on
//   the client. It's not possible to invoke a client function from the server.
//
// So these two helpers are deliberately exported from a module with NO
// 'use client' directive. They are pure string functions with no hooks and no
// browser access, so they belong on the server side of the boundary.
//
// `npm run check:server-imports` fails the build if any non-client module imports
// a client-module export and CALLS it. Do not move these back into PillTabs.tsx
// and do not re-export them from it: a `create or replace` style re-export
// rebuilds exactly the trap these were extracted to remove.
//
// This module is the existing precedent for a lowercase pure module beside a
// component in this directory - see navItems.ts.

/** The id a tab carries, given its group's prefix and the item's key. */
export function pillTabId(prefix: string, key: string): string {
  return `${prefix}-tab-${key}`;
}

/**
 * The id of the panel a tab controls.
 *
 * PillTabs.tsx emits it, and it only makes sense to compute it in the same
 * module: an `aria-controls` pointing at a renamed id is a broken relationship,
 * and it renders perfectly while announcing nothing.
 */
export function pillTabPanelId(prefix: string, key: string): string {
  return `${prefix}-panel-${key}`;
}
