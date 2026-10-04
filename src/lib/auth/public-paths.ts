// Which paths may be reached WITHOUT a session.
//
// Extracted from `src/proxy.ts` as a PURE function so it can be unit tested.
// A routing decision that decides who may reach the application is not something to
// verify only by reading it: the provider callback allowlist below is a
// security-relevant line, and "is this path public" needs an assertion that can fail.
//
// This decides only whether a REQUEST IS ROUTED. It never authorizes anything. Every
// page and route that matters re-checks the session and capability server-side,
// because a proxy match is a navigation convenience rather than an authorization
// decision (law 3, law 17, doc 71 law 1).

/** Paths that are public in their entirety. */
const PUBLIC_PATHS = new Set(['/', '/sign-in', '/sign-up', '/auth/callback', '/reviews']);

/** Path prefixes that are public below this point. */
const PUBLIC_PREFIXES = ['/reviews/'];

/**
 * The provider callback endpoint, and WHY it has to be public.
 *
 * `/api/providers/callbacks/<code>` is called by a THIRD-PARTY SERVER, not by a
 * signed-in user. CPX Research has no Averra session and cannot obtain one. The route
 * was written to be unauthenticated from the start - it deliberately does not use the
 * `route()` helper, because its authentication IS the provider signature verified
 * inside `ingestProviderCallback`.
 *
 * While this was absent, every postback returned `307 -> /sign-in`. The provider
 * received an HTML login page instead of a JSON acknowledgement, the ingest pipeline
 * was never reached, and `app.provider_callbacks` stayed EMPTY - no error, no log, no
 * conversion. The failure is indistinguishable from "the provider is not sending
 * anything", which is how a three-line allowlist can cost weeks.
 *
 * THE PATTERN IS DELIBERATELY EXACT, NOT A BLANKET PREFIX.
 *
 *   /api/providers/callbacks/<provider-code>
 *
 * The provider segment must match the same `^[a-z0-9_]{2,64}$` shape the route itself
 * validates. That keeps `/api/providers/*` - every other provider route, including
 * anything administrative - private, and stops a path such as
 * `/api/providers/callbacksX` or a traversal segment from matching by accident.
 */
const PROVIDER_CALLBACK_PATH = /^\/api\/providers\/callbacks\/[a-z0-9_]{2,64}\/?$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  return PROVIDER_CALLBACK_PATH.test(pathname);
}

/**
 * Whether a path must stay behind a session.
 *
 * Provided so a test can assert the negative case directly. Asserting only that the
 * callback IS public would pass just as happily if the whole API were public - the
 * failure mode being guarded against is an over-broad allowlist, and only the
 * negative assertion catches it.
 */
export function requiresSession(pathname: string): boolean {
  return !isPublicPath(pathname);
}
