'use client';

import Script from 'next/script';
import {
  AD_BREAKPOINT_PREFIX,
  reservedSizeFor,
  type AdFormat,
} from '@/lib/ads/placements';
import { readAdZone } from '@/lib/ads/delivery';

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
// WHY IT RENDERS NOTHING WHEN UNCONFIGURED
//
// `readAdZone` returns null until the operator pastes a real zone id and loader URL
// from their dashboard, which has not happened yet. The slot therefore emits no
// wrapper, no placeholder and no script. Shipping a default that renders an empty
// bordered box on the home page would be worse than shipping nothing: it would be
// visible in review, approved as "obviously coming", and still broken in production.
//
// RESERVED SPACE, NOT LAYOUT SHIFT
//
// A fixed banner reserves its exact pixel box before the creative loads, so the
// paragraph below it does not jump. The height is a real CSS value rather than an
// aspect-ratio guess because the formats are fixed sizes - we know them exactly.

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
        <div className="h-24 w-full max-w-md" />
      )}

      {/*
        The vendor loader, loaded after hydration so it cannot compete with our own
        critical path, and rendered only when a zone is actually configured.

        `next/script` rather than a raw <script> because it deduplicates by `id` and
        respects the framework's own loading order. `data-nscript` is left alone; we do
        not want to intercept the vendor script.
      */}
      <Script
        id={`adsterra-${id}`}
        src={zone.scriptSrc}
        strategy="afterInteractive"
        data-ad-zone={zone.key}
      />
    </aside>
  );
}