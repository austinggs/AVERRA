'use client';

import Script from 'next/script';
import {
  AD_BREAKPOINT_PREFIX,
  reservedSizeFor,
  type AdFormat,
} from '@/lib/ads/placements';
import { adContainerId, buildAdAtOptions, readAdZone } from '@/lib/ads/delivery';

// The ad slot. ONE component for every approved format.
//
// PURE RENDERING, NO DECISIONS OF ITS OWN
//
// This component decides nothing. Eligibility is `placementsForPath` in
// `src/lib/ads/placements.ts`, zone lookup is `readAdZone` in `src/lib/ads/delivery.ts`,
// and neither this file nor any of those can touch a balance. If `AdSlot` were given
// a session, an ad would sit next to money on a page that reads money, and the whole
// "public routes only" rule would be enforced by nothing at all.
//
// TWO DIFFERENT VENDOR SHAPES, AND GETTING THIS WRONG IS SILENT
//
// The dashboard issues two unrelated snippets and they are NOT interchangeable:
//
//   NATIVE   <script async src=".../<key>"></script>
//            <div id="container-<key>"></div>
//
//   FIXED    <script>atOptions = { key, format, width, height, params }</script>
//            <script src=".../<key>"></script>
//
// An earlier version of this file emitted ONLY the loader <script src> for both. That
// renders nothing at all, for either format, and fails silently in both cases:
//
//   - native: the loader resolves `container-<key>`, and with no such element it has no
//     mount point. No error, no failed request, an empty box.
//   - fixed: without `atOptions` the loader has no key, no dimensions and no format.
//
// Every screenshot still looks healthy, which is exactly why the absence has to be
// asserted rather than eyeballed. This is the AGENTS.md "a wrong CSP host blocks the
// ad SILENTLY" failure, one layer down: the failure mode here is absence, and absence
// is what review misses.
//
// THE ORDER OF THE TWO FIXED-BANNER SCRIPTS IS LOAD-BEARING
//
// `atOptions` must be assigned BEFORE the loader executes, because the loader reads the
// global at execution time. React renders them in document order and `next/script`
// preserves that order for two `afterInteractive` scripts, so the assignment is emitted
// first and the loader second. Reversing them yields a loader that runs against an
// undefined global - again silently.
//
// `atOptions` is a single global shared by every fixed banner on the page, which is why
// `validatePlacements` permits only ONE banner placement per route. See the atOptions
// section in `placements.ts` before adding a second.
//
// RESERVED SPACE, NOT LAYOUT SHIFT
//
// A fixed banner reserves its exact pixel box before the creative loads, so the
// paragraph below it does not jump. The height is a real CSS value rather than an
// aspect-ratio guess because the formats are fixed sizes - we know them exactly. The
// size passed to `buildAdAtOptions` comes from the same `reservedSizeFor` call, so the
// box the loader is told to render into and the box we reserved cannot disagree.

export type AdSlotProps = {
  format: AdFormat;
  /** Smallest viewport at which this slot renders. */
  showFrom: 'base' | 'sm' | 'md' | 'lg';
  /** Stable id for the script tag, so React does not remount it between renders. */
  id: string;
};

export function AdSlot({ format, showFrom, id }: AdSlotProps) {
  const zone = readAdZone(format);

  if (!zone) return null;

  const size = reservedSizeFor(format);
  const prefix = AD_BREAKPOINT_PREFIX[showFrom];

  // `hidden` until the breakpoint, then `flex` via the prefix. Both classes are
  // literal-ish strings composed from a fixed map, so Tailwind's scanner sees the
  // final classes in `AD_BREAKPOINT_PREFIX` and in this file.
  const visibility = prefix ? `hidden ${prefix}:flex` : 'flex';

  return (
    <aside
      aria-label="Advertisement"
      // `data-ad-placement` is not decoration: it is how a placement is identified
      // in the DOM when someone is debugging why an ad did or did not render.
      data-ad-placement={id}
      data-ad-format={format}
      className={`${visibility} flex-col items-center justify-center overflow-hidden`}
    >
      {size ? (
        <div
          style={{ width: size.width, height: size.height }}
          className="max-w-full"
        />
      ) : (
        /*
          NATIVE MOUNT POINT. This id is the entire contract with the vendor loader and
          must be exactly `container-<key>`. Omit it and the loader has nowhere to mount.
        */
        <div id={adContainerId(zone.key)} className="h-24 w-full max-w-md" />
      )}

      {size ? (
        <FixedBannerScripts zoneKey={zone.key} scriptSrc={zone.scriptSrc} size={size} id={id} />
      ) : (
        <Script
          id={`adsterra-${id}`}
          src={zone.scriptSrc}
          strategy="afterInteractive"
          // The vendor snippet marks the native loader `async` and `data-cfasync="false"`.
          // Reproduced verbatim: `data-cfasync` stops Cloudflare's Rocket Loader from
          // rewriting this tag, which would break an order-dependent loader.
          async
          data-cfasync="false"
          data-ad-zone={zone.key}
        />
      )}
    </aside>
  );
}

/**
 * The vendor's options global.
 *
 * Typed here rather than with a project-wide `declare global` because this is the only
 * place that touches it, and a global declaration for a third-party variable is a
 * wider surface than this feature needs. `AdAtOptions` is imported from `delivery.ts`
 * structurally below so the two cannot drift.
 */
declare global {
  interface Window {
    atOptions?: import('@/lib/ads/delivery').AdAtOptions;
  }
}

/**
 * The two scripts a fixed-size banner needs, in the order the vendor requires.
 *
 * Extracted as its own component purely so the ORDERING is visible and reviewable in
 * one place. The order is the contract: `atOptions` is assigned by a plain inline script
 * that runs during document parse, and the loader is an `afterInteractive` `next/script`
 * that necessarily runs after it. A loader that executes first reads `undefined` and
 * renders nothing, with no error - so this must not be reordered casually.
 */
function FixedBannerScripts({
  zoneKey,
  scriptSrc,
  size,
  id,
}: {
  zoneKey: string;
  scriptSrc: string;
  size: { width: number; height: number };
  id: string;
}) {
  return (
    <>
      {/*
        The options object, assigned before the loader runs.

        `JSON.stringify` receives a value WE construct from a validated zone key and our
        own size table - never raw env text - so it cannot carry script content. The key
        is constrained to `[A-Za-z0-9_-]` by `isAdZoneKey` in `delivery.ts`, which is
        what makes this safe rather than merely intended to be.
      */}
      <script
        // No `eslint-disable` here on purpose: the react plugin is not enabled in this
        // repo, so one would be an unused directive (and lint warns about exactly
        // that). The safety argument is recorded above instead of in a suppression -
        // the zone key is bounded by `isAdZoneKey`, so this cannot carry script
        // content regardless of lint configuration.
        dangerouslySetInnerHTML={{
          __html: `window.atOptions=${JSON.stringify(buildAdAtOptions(zoneKey, size))};`,
        }}
      />
      <Script
        id={`adsterra-${id}`}
        src={scriptSrc}
        strategy="afterInteractive"
        data-ad-zone={zoneKey}
      />
    </>
  );
}