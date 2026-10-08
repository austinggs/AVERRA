// Ad placement policy (CR-0039).
//
// PROVIDER-NEUTRAL, REVENUE-ONLY, PUBLIC-ROUTES-ONLY. All three are structural here
// rather than a matter of reviewer discipline.
//
// 1. REVENUE ONLY. Nothing in this module or `src/lib/ads/config.ts` can produce a
//    reward, a ledger entry, a wallet mutation or a participation row. Adsterra pays
//    US in CPM/CPC for ad impressions. It is NOT registered as a provider in
//    `src/lib/providers/registry.ts`, has no row in `app.providers`, and has no
//    adapter. Adding it to any of those would be a different subsystem with different
//    laws (law 5 idempotency, law 12 replaceability, the settlement gate) and it is
//    deliberately absent. An impression and a conversion are not the same object here.
//
// 2. PUBLIC ROUTES ONLY. `isAdEligibleRoute` DELEGATES to `isPublicPath` rather than
//    keeping its own list, so there is exactly one definition of "public" in this
//    repository and an ad cannot drift onto an authenticated route by being added to
//    a second, separately-maintained set. That is the property worth protecting: an
//    ad next to a balance is a financial-adjacent surface, and it must not be able to
//    appear inside the sessioned app by accident.
//
// 3. PROVIDER NEUTRAL. Formats, sizes and breakpoints are vendor-neutral concepts.
//    The vendor appears exactly twice: in the `NEXT_PUBLIC_ADSTERRA_*` variable names
//    (`config.ts`, which is configuration) and in the loader URL the operator pastes
//    from their own dashboard. Swapping vendors rewrites config, not this module.
//
// WHY THIS IS A SEPARATE PURE MODULE
//
// A placement is a rendering decision with an authorization-adjacent edge to it. It
// cannot be verified by reading `page.tsx`, and an iframe is not unit testable, so
// every decision that can be expressed as a pure question lives here instead.

import { isPublicPath } from '@/lib/auth/public-paths';
import { AD_FORMATS, isAdFormat, type AdFormat } from '@/lib/ads/delivery';

/**
 * The ad format allowlist lives in `delivery.ts`, not here.
 *
 * Re-exported because the CSP builder, the loader configuration and the placement
 * policy must all agree on which formats exist, and they cannot do that by importing
 * each other in a cycle. `delivery.ts` is the leaf; this module owns placement
 * decisions.
 */
export { AD_FORMATS, isAdFormat };
export type { AdFormat };

/** The fixed-size subset. `native` has no intrinsic dimensions. */
export const BANNER_FORMATS = ['300x250', '320x50', '728x90'] as const;
export type BannerFormat = (typeof BANNER_FORMATS)[number];

/**
 * Formats we have deliberately NOT enabled, and why.
 *
 * Recorded as data rather than as prose so a future contributor adding one has to
 * delete a line that names the consequence rather than quietly widening a union.
 *
 * These are OUR policy decisions for this deployment, not a statement about what
 * Adsterra offers or permits:
 *
 *   popunder          opens on click. On `/sign-in` and `/sign-up` that is an ad
 *                     covering a credential form, which is hostile and would very
 *                     likely trip our own fraud and support load.
 *   social_bar        injects a fixed overlay into the viewport. The Mining Game
 *                     (doc 17/31) is a full-bleed interactive surface; an overlay on
 *                     top of it is a usability defect even on a public page.
 *   push_notification requires a subscription the visitor never asked for.
 *   interstitial      full-screen takeover.
 *
 * None of these are approved for this deployment pending the compliance review
 * tracked in CR-0039. They are withheld by policy, not by capability.
 */
export const EXCLUDED_AD_FORMATS = [
  'popunder',
  'social_bar',
  'push_notification',
  'interstitial',
] as const;
export type ExcludedAdFormat = (typeof EXCLUDED_AD_FORMATS)[number];

export function isBannerFormat(value: string): value is BannerFormat {
  return (BANNER_FORMATS as readonly string[]).includes(value);
}

/**
 * Intrinsic pixel size per fixed banner format.
 *
 * Used to reserve space before the ad arrives, so the page does not reflow when it
 * does. Layout shift is the reason a slot renders a reserved box rather than nothing.
 */
export const BANNER_SIZE_BY_FORMAT: Record<BannerFormat, { width: number; height: number }> = {
  '300x250': { width: 300, height: 250 },
  '320x50': { width: 320, height: 50 },
  '728x90': { width: 728, height: 90 },
};

/** The Tailwind `min-width` prefix a placement first becomes visible at. */
export const AD_BREAKPOINTS = ['base', 'sm', 'md', 'lg'] as const;
export type AdBreakpoint = (typeof AD_BREAKPOINTS)[number];

/**
 * `base` maps to no prefix at all; the others are real Tailwind prefixes. Kept as a
 * map so a component never has to build the string and get the `base` case wrong.
 */
export const AD_BREAKPOINT_PREFIX: Record<AdBreakpoint, string> = {
  base: '',
  sm: 'sm:',
  md: 'md:',
  lg: 'lg:',
};

export type AdPlacement = {
  id: string;
  /**
   * The route this placement belongs to, EXACTLY as it appears in the app router.
   * Never a pattern: an ad rendered on a route nobody enumerated is an ad nobody
   * reviewed.
   */
  path: string;
  format: AdFormat;
  /** Smallest viewport at which this placement renders. */
  showFrom: AdBreakpoint;
};

/**
 * THE APPROVED PLACEMENT LIST.
 *
 * `/` only. Explicitly absent: `/sign-in`, `/sign-up`, and everything under the
 * `(app)` route group, which is session-gated by `src/proxy.ts`.
 *
 * Breakpoints are staggered so a single viewport never stacks three ads: a phone
 * gets the 320x50 leaderboard, a tablet adds the 300x250 rectangle, a desktop adds
 * the 728x90 leaderboard. The native banner is `base` and renders at every width.
 */
export const AD_PLACEMENTS: readonly AdPlacement[] = [
  { id: 'home-native', path: '/', format: 'native', showFrom: 'base' },
  { id: 'home-320x50', path: '/', format: '320x50', showFrom: 'base' },
  { id: 'home-300x250', path: '/', format: '300x250', showFrom: 'md' },
  { id: 'home-728x90', path: '/', format: '728x90', showFrom: 'lg' },
] as const;

/**
 * Whether a route may carry ads at all.
 *
 * BOTH conditions, and the second is not redundant:
 *
 *   - the route is in our approved placement set, AND
 *   - `isPublicPath` agrees the route is public.
 *
 * The second check is what makes this fail safe. If someone adds a placement on
 * `/wallet` and the public-path list is later narrowed or the route moves, this
 * returns false regardless of what the placement table says. Two independent gates,
 * one of which is owned by auth and not by ads.
 */
export function isAdEligibleRoute(pathname: string): boolean {
  if (!AD_PLACEMENTS.some((placement) => placement.path === pathname)) return false;
  return isPublicPath(pathname);
}

/** Placements that are approved for a route, in declaration order. */
export function placementsForPath(pathname: string): AdPlacement[] {
  if (!isAdEligibleRoute(pathname)) return [];
  return AD_PLACEMENTS.filter((placement) => placement.path === pathname);
}

export function findPlacement(id: string): AdPlacement | null {
  return AD_PLACEMENTS.find((placement) => placement.id === id) ?? null;
}

/** The pixel box a slot reserves before the ad arrives. Null for `native`. */
export function reservedSizeFor(format: AdFormat): { width: number; height: number } | null {
  return isBannerFormat(format) ? BANNER_SIZE_BY_FORMAT[format] : null;
}

/**
 * A self-check over the placement table. Returns problems; empty means clean.
 *
 * This exists so the policy is verified by an ASSERTION rather than by reading a
 * table. Per the AGENTS.md rule that a check must be shown to fail, `tests/ads/
 * placements.test.ts` runs this against deliberately broken tables and asserts each
 * rule is reported - a green run on valid input proves nothing on its own.
 *
 * Takes its input as a parameter precisely so the tests can feed it a bad table.
 */
export function validatePlacements(placements: readonly AdPlacement[] = AD_PLACEMENTS): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const placement of placements) {
    const label = placement.id || '(unnamed)';

    if (seenIds.has(placement.id)) {
      problems.push(`${label}: duplicate placement id`);
    }
    seenIds.add(placement.id);

    if (!isPublicPath(placement.path)) {
      problems.push(`${label}: route ${placement.path} requires a session, so it must not carry ads`);
    }

    if (!AD_PLACEMENTS.some((approved) => approved.path === placement.path)) {
      problems.push(`${label}: route ${placement.path} is not in the approved placement set`);
    }

    if (!isAdFormat(placement.format)) {
      problems.push(`${label}: format ${String(placement.format)} is not in the allowlist`);
    }

    if (!AD_BREAKPOINTS.includes(placement.showFrom)) {
      problems.push(`${label}: breakpoint ${String(placement.showFrom)} is not a known breakpoint`);
    }

    if ((EXCLUDED_AD_FORMATS as readonly string[]).includes(placement.format)) {
      problems.push(`${label}: format ${placement.format} is explicitly excluded`);
    }
  }

  return problems;
}