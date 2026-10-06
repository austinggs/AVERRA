# CR-0034 - Responsive navigation rework

- **Status:** Complete.
- **Date:** 2026-10-06
- **Authorities:** 09_USER_EXPERIENCE (doc 09 NAVIGATION), 51_FRONTEND_ARCHITECTURE,
  CR-0004 design system (tap targets, focus rings, MoneyState untouched), 79_AGENTS.md
  design-system rules. UI only: no money path, no migration, no API contract changed.

## Why this change exists

Two navigation defects, both reported from real viewports:

1. **Desktop had no top navigation.** From `md` up, the only way to change section
   was a `md:static` bottom bar rendered as a footer row at the *end of the page* -
   navigating meant scrolling to the bottom of every page.
2. **Nine tabs in the mobile bar broke the 44px tap rule.** At 320-375px, nine
   destinations work out to ~35px each. The design system requires at least 44px for
   every interactive element.

## What changed

- **`src/components/ui/navItems.ts` (new)** - the destination split as data:
  `CORE_TABS` (6) and `SECONDARY_TABS` (3), with the constraint that they stay
  disjoint documented and asserted in tests.
- **`src/components/ui/TopNav.tsx` (new)** - sticky-header navigation, visible from
  `md` up: icon pills at `md`-`lg` (nine labelled items do not fit beside the logo
  and session actions at those widths; the text label still names every link and
  `title` gives a native tooltip), full labels from `xl`. The header widens to
  `lg:max-w-7xl` while `main` keeps its `max-w-3xl` measure - content measure and
  navigation chrome are different constraints (nine labelled items need ~870px
  beside the logo and the session actions; `max-w-6xl` left the nav scrolling
  inside its own `overflow-x-auto` at exactly 1280px).
- **`src/components/ui/BottomNav.tsx` (reworked)** - now mobile only (`md:hidden`):
  six core tabs (~53px each even at 320px) plus a **"More" sheet** holding the three
  secondary destinations. The sheet is a real modal dialog: `role="dialog"`,
  `aria-modal`, Escape closes, backdrop closes, focus is trapped while open and
  returns to the trigger, body scroll is locked, and it closes on route change
  (browser Back while open). Secondary badges aggregate onto the More trigger with
  an sr-only count. Shared primitives (`NavIcon`, `NavBadge`, `isActive`) are
  exported so the two navs cannot drift.
- **`src/app/(app)/layout.tsx`** - renders `TopNav` in the sticky header, passes
  the split arrays to `BottomNav`, and drops the old footer-row wrapper.
- **`src/app/globals.css`** - the `.nav-sheet` slide-up keyframe. Duration is
  neutered by the existing `prefers-reduced-motion` block, so the sheet never
  depends on its animation to become usable.
- **`playwright.config.ts`** - added a `mobile-chrome` (Pixel 7) project and a
  `webServer` entry so `npm run e2e` actually runs. Mobile-only UI cannot be seen
  by a desktop-only run at all.
- **`.gitignore`** - `test-results/` and `playwright-report/` (Playwright artifacts
  were not ignored because no e2e test had ever executed).

## Tests

- **`tests/ui/navigation.test.tsx` (13 tests)** - the split (6/3/disjoint/unique -
  fails if a seventh core tab is added silently), the `md:hidden`/`md:flex` gates
  themselves (fails if either is removed), `aria-current`, the sheet's dialog
  semantics, Escape + focus restore + scroll unlock, backdrop vs sheet click,
  badge aggregation, and TopNav rendering every destination exactly once.
  Per Q-46: every gate has a named test that fails when the gate is removed.
- **`tests/e2e/smoke.spec.ts` (3 specs x 2 projects)** - public-path routing and a
  horizontal-overflow check on sign-in at desktop and Pixel-7 viewports.

## Deliberately NOT changed

- `main` keeps `max-w-3xl`. The wide-screen "empty space" finding is a content-layout
  decision, not a navigation one; widening it was left out of this record so the
  navigation change stays reviewable on its own.
- No icon package was added; the nine glyphs remain inline SVG.
- `MoneyState`, badges on financial states, and every money surface: untouched.
