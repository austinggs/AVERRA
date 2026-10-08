// Ad delivery: the loader configuration, and the security policy derived from it.
//
// WHY THIS MODULE HAS NO IMPORTS. THAT IS THE WHOLE REASON IT EXISTS AS ITS OWN FILE.
//
// `next.config.ts` needs the CSP at build time. Next compiles that config to CJS and
// `require`s it, and a Node `require` cannot resolve an extensionless `.ts` specifier
// in a NESTED module - so `next.config.ts -> csp.ts -> config.ts` fails the build with
// `MODULE_NOT_FOUND` even though `vitest`, `tsc` and `eslint` all pass, because they
// all resolve TypeScript and a compiled CJS config does not.
//
// This is the AGENTS.md "a lint cannot see it" family again, one level up: the defect
// is invisible to typecheck and to the test suite and only appears at `next build`.
//
// So this file is a LEAF. It imports nothing, `next.config.ts` imports only this, and
// everything else in `src/lib/ads/` imports from here. If a future change adds an
// import to this file the build breaks immediately and visibly, which is the correct
// time to find out.
//
// It holds the format list because the CSP and the loader configuration must agree on
// which formats exist; `placements.ts` re-exports the list and owns placement policy.

// WHY THE LOADER URL IS OPERATOR CONFIGURATION AND NOT A CONSTANT HERE
//
// Adsterra's own publisher documentation is JavaScript-rendered and could not be read
// as literal markup by any of four independent attempts during CR-0039, and search
// engines serving it returned bot challenges. Writing a plausible-looking loader URL
// from memory would be exactly the invention doc 78 forbids, and the failure mode is
// nasty: the wrong host in a CSP `script-src` silently blocks the ad, the slot
// renders empty forever, and the page looks healthy in every screenshot. A wrong
// constant is therefore more expensive here than no constant.
//
// So the operator pastes BOTH values verbatim from the Adsterra publisher dashboard,
// per zone:
//
//   NEXT_PUBLIC_ADSTERRA_<FORMAT>_KEY     the zone identifier
//   NEXT_PUBLIC_ADSTERRA_<FORMAT>_SCRIPT  the exact <script src> the dashboard shows
//
// `NEXT_PUBLIC_` is correct and deliberate: an Adsterra zone id is a PUBLIC client
// identifier printed into the HTML of every page that shows the ad. It is not a
// credential, authorizes no API call against our systems, and grants access to
// nothing. This is categorically different from `SUPABASE_SECRET_KEY`, which must
// never carry the `NEXT_PUBLIC_` prefix.
//
// IF YOU CHANGE A SCRIPT URL, YOU DO NOT TOUCH THE CSP. `adDeliveryOrigins` derives
// the policy from whatever URLs are configured, so the two cannot drift.

/**
 * The only ad formats this application will ever render.
 *
 * Defined here rather than in `placements.ts` because the CSP and the loader
 * configuration must agree on which formats exist, and this is the module both can
 * reach.
 */
export const AD_FORMATS = ['native', '300x250', '320x50', '728x90'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export function isAdFormat(value: string): value is AdFormat {
  return (AD_FORMATS as readonly string[]).includes(value);
}

/** Env var names per format, in ONE map. */
export const AD_ENV_VARS: Record<AdFormat, { key: string; script: string }> = {
  native: { key: 'NEXT_PUBLIC_ADSTERRA_NATIVE_KEY', script: 'NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT' },
  '300x250': { key: 'NEXT_PUBLIC_ADSTERRA_300X250_KEY', script: 'NEXT_PUBLIC_ADSTERRA_300X250_SCRIPT' },
  '320x50': { key: 'NEXT_PUBLIC_ADSTERRA_320X50_KEY', script: 'NEXT_PUBLIC_ADSTERRA_320X50_SCRIPT' },
  '728x90': { key: 'NEXT_PUBLIC_ADSTERRA_728X90_KEY', script: 'NEXT_PUBLIC_ADSTERRA_728X90_SCRIPT' },
};

/**
 * Reads the public ad env vars as an object.
 *
 * EVERY `process.env` ACCESS IS A LITERAL MEMBER EXPRESSION AND THAT IS LOAD
 * BEARING. Next inlines `process.env.NEXT_PUBLIC_FOO` textually at build time. A
 * dynamic `process.env[name]` lookup is NOT inlined, it resolves to undefined in the
 * browser, and the failure is silent - the slot simply never renders and no error is
 * raised anywhere.
 */
export function readPublicAdEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_KEY,
    NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT,
    NEXT_PUBLIC_ADSTERRA_300X250_KEY: process.env.NEXT_PUBLIC_ADSTERRA_300X250_KEY,
    NEXT_PUBLIC_ADSTERRA_300X250_SCRIPT: process.env.NEXT_PUBLIC_ADSTERRA_300X250_SCRIPT,
    NEXT_PUBLIC_ADSTERRA_320X50_KEY: process.env.NEXT_PUBLIC_ADSTERRA_320X50_KEY,
    NEXT_PUBLIC_ADSTERRA_320X50_SCRIPT: process.env.NEXT_PUBLIC_ADSTERRA_320X50_SCRIPT,
    NEXT_PUBLIC_ADSTERRA_728X90_KEY: process.env.NEXT_PUBLIC_ADSTERRA_728X90_KEY,
    NEXT_PUBLIC_ADSTERRA_728X90_SCRIPT: process.env.NEXT_PUBLIC_ADSTERRA_728X90_SCRIPT,
  };
}

/**
 * Fails closed on a loader URL that is not plain http(s).
 *
 * A `javascript:` or `data:` value reaching a `<script src>` would be a stored-XSS
 * sink. It would have to come from our own deployment environment to get there, but
 * the cost of the check is one parse and the benefit is that a misconfigured value
 * renders no ad rather than executing.
 */
export function isLoadableScriptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The origins the CSP must allow for ad delivery, derived from configured zones.
 *
 * Built from the operator's script URLs rather than from a hand-maintained host list.
 * A hand-maintained list is correct on the day it is written, and the day the operator
 * pastes a new zone URL from the dashboard the CSP silently stops matching and the ad
 * stops rendering with nothing in the logs.
 *
 * Sorted and de-duplicated so the header value is stable between builds and a CSP
 * report diff is readable.
 */
export function adDeliveryOrigins(
  env: Record<string, string | undefined> = readPublicAdEnv(),
): string[] {
  const origins = new Set<string>();

  for (const format of AD_FORMATS) {
    const vars = AD_ENV_VARS[format];
    const scriptSrc = env[vars.script]?.trim();

    if (!scriptSrc || !isLoadableScriptUrl(scriptSrc)) continue;

    try {
      origins.add(new URL(scriptSrc).origin);
    } catch {
      // Unreachable: isLoadableScriptUrl already parsed it. Kept so a future caller
      // cannot turn a typo into a thrown BUILD rather than a thrown test.
    }
  }

  return [...origins].sort();
}

/**
 * A zone identifier is a short opaque token, and it is validated rather than trimmed.
 *
 * This is not paranoia about the vendor. The key is interpolated into a DOM element
 * id (`container-<key>`) and into the `atOptions` object the vendor loader reads, so a
 * value carrying whitespace, quotes or angle brackets would produce markup that does
 * not match the id the loader looks for. The failure mode is identical to a typo: the
 * slot renders empty and nothing is logged anywhere.
 *
 * The character class is the intersection of what the four supplied Adsterra zones use
 * (32-char lowercase hex) and what an id and an object key may safely contain. It is
 * deliberately wider than hex so a vendor that rotates to another opaque token is not
 * rejected by our validation.
 */
export function isAdZoneKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export type AdZoneConfig = {
  /** The zone identifier supplied by the dashboard. */
  key: string;
  /** The exact loader <script src> supplied by the dashboard. */
  scriptSrc: string;
};

/**
 * The element id the NATIVE loader looks for.
 *
 * The native snippet is a loader script PLUS a container div whose id embeds the zone
 * key: `<script src=".../<key>"></script><div id="container-<key>"></div>`. The loader
 * resolves that id to find its mount point.
 *
 * This is the reason a native ad can render NOTHING while every screenshot still looks
 * healthy: omit the id and the loader finds no container, quietly. There is no error,
 * no console message and no failed request - the page simply has an empty box. It is
 * the same class of defect as a wrong CSP host, where the failure is absence rather
 * than an exception, and absence is what gets missed in review.
 */
export function adContainerId(key: string): string {
  return `container-${key}`;
}

/**
 * The `atOptions` object the fixed-size loader reads before it does anything else.
 *
 * The fixed-size snippet is an inline assignment FOLLOWED BY the loader script:
 *
 *     <script>atOptions = { key, format: 'iframe', height, width, params: {} }</script>
 *     <script src=".../<key>"></script>
 *
 * So `format`, `width` and `height` are not decoration - omitting any one of them
 * leaves the loader with nothing to render into.
 *
 * `width`/`height` are passed in rather than looked up from the format because
 * `delivery.ts` is a LEAF and must not import `placements.ts`, which is the module that
 * owns the size table. The caller passes `reservedSizeFor(format)`, so the two cannot
 * disagree.
 */
export type AdAtOptions = {
  key: string;
  format: 'iframe';
  width: number;
  height: number;
  params: Record<string, never>;
};

export function buildAdAtOptions(key: string, size: { width: number; height: number }): AdAtOptions {
  return { key, format: 'iframe', width: size.width, height: size.height, params: {} };
}

/**
 * The configured zone for a format, or null when it is not fully configured.
 *
 * Null is the normal, expected state before an operator fills these in, and it makes
 * `AdSlot` render nothing at all. That is the right default: a half-configured ad
 * must degrade to invisible rather than to a broken frame.
 */
export function readAdZone(
  format: AdFormat,
  env: Record<string, string | undefined> = readPublicAdEnv(),
): AdZoneConfig | null {
  const vars = AD_ENV_VARS[format];

  const key = env[vars.key]?.trim();
  const scriptSrc = env[vars.script]?.trim();

  if (!key || !scriptSrc) return null;
  // Fails CLOSED. A key that is present but unusable is a misconfiguration, and the
  // honest response is to render no ad rather than to render one whose container id the
  // loader cannot match.
  if (!isAdZoneKey(key)) return null;
  if (!isLoadableScriptUrl(scriptSrc)) return null;

  return { key, scriptSrc };
}

/**
 * Whether the ad subsystem is configured enough to render anything.
 *
 * Exposed so a build or a health check can assert the subsystem is INERT rather than
 * assuming it: until an operator pastes real values, this is false and no ad renders.
 */
export function isAdSubsystemConfigured(
  env: Record<string, string | undefined> = readPublicAdEnv(),
): boolean {
  return AD_FORMATS.some((format) => readAdZone(format, env) !== null);
}

export type CspOptions = {
  /**
   * When true, emit `Content-Security-Policy-Report-Only`.
   * Flipping this is step 4 of the rollout and must not happen before steps 1-3.
   */
  reportOnly?: boolean;
  reportUri?: string;
  /** Env source, injected by tests and by `next.config.ts`. */
  env?: Record<string, string | undefined>;
};

export const DEFAULT_CSP_REPORT_URI = '/api/csp-report';

export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
export const CSP_ENFORCE_HEADER = 'Content-Security-Policy';

/**
 * Origins the app itself needs, independent of ads.
 *
 * Supabase is read from configuration rather than hardcoded, because the project ref
 * is per-deployment and a wrong host here would break the Supabase client in a way
 * that looks like an auth outage.
 *
 * `wss://` is required for Supabase Realtime. It is NOT a wildcard: the host is
 * derived, so this does not become "any wss origin".
 */
function applicationOrigins(env: Record<string, string | undefined>): string[] {
  const origins: string[] = [];
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!supabaseUrl) return origins;

  try {
    const url = new URL(supabaseUrl);
    origins.push(url.origin);
    if (url.protocol === 'https:') origins.push(url.origin.replace('https://', 'wss://'));
  } catch {
    // A malformed URL must not break the build. The Supabase client reports this with
    // a far better message than a header assembly error would.
  }

  return origins;
}

/**
 * Builds the policy as an ordered directive string.
 *
 * Directive order is stable so a diff between two deployments is readable. Every
 * directive's values are de-duplicated and sorted, so no directive can appear twice.
 *
 * REPORT-ONLY FIRST, AND `'unsafe-inline'` IS NOT LAZINESS
 *
 * This ships report-only. Enforcing a CSP for the first time on a page that already
 * works, in the same change that introduces a third-party script, is how a deployment
 * ends up with a blank white home page and no obvious cause.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are still present because Next's runtime emits
 * an inline bootstrap script and dev-mode HMR re-evaluates modules on the client;
 * without them hydration fails on EVERY route. They are logged as violations today so
 * we can see exactly which directives are load-bearing before removing them via a
 * nonce, rather than removing them and discovering the breakage in production.
 *
 * The permissive parts are OURS, not Adsterra's: `frame-src` and `connect-src`
 * already carry only the verified ad origins.
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  // `readPublicAdEnv()` and NOT `{}`.
  //
  // This previously defaulted to `{}`, and `next.config.ts` calls this function with no
  // `env`. The result was a policy derived from an EMPTY environment: no ad origin ever
  // reached `script-src`, while the client bundle inlined the real zone URLs. So the page
  // loaded the ad loader from a host the CSP did not permit.
  //
  // Because the CSP ships REPORT-ONLY, nothing blocked and nothing was logged as an
  // error - the ad simply never rendered, while every screenshot looked healthy. Flip to
  // enforcement and the same code would have blocked every ad in production. This is the
  // AGENTS.md rule about a value that is correct in tests and absent in production,
  // reached from the opposite direction: the tests always passed an explicit `env`, so
  // the default was never exercised by anything that could have caught it.
  const env = options.env ?? readPublicAdEnv();
  const reportUri = options.reportUri ?? DEFAULT_CSP_REPORT_URI;

  const adOrigins = adDeliveryOrigins(env);
  const appOrigins = applicationOrigins(env);

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...adOrigins]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:']],
    // blob: is required by the Mining Game's Three.js worker (doc 17/31). It is a
    // worker source, not a script source, so it grants the worker no DOM access.
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'", ...adOrigins]],
    ['connect-src', ["'self'", ...appOrigins, ...adOrigins]],
    ['report-uri', [reportUri]],
  ];

  return directives
    .map(([name, values]) => `${name} ${[...new Set([...values].sort())].join(' ')}`)
    .join('; ');
}

/**
 * The header name to emit.
 *
 * A function rather than a boolean at the call site so `next.config.ts` cannot
 * accidentally emit an enforced header while still passing `reportOnly: true`.
 */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_ENFORCE_HEADER;
}