import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /auth/callback - the OAuth / magic-link code exchange.
 *
 * `safeNext` has its own unit suite (tests/auth/next.test.ts). That suite proves the
 * HELPER rejects `/\evil.com`. It cannot prove the ROUTE calls the helper, and it
 * cannot prove anything about the path the route takes when the exchange FAILS -
 * which is a different branch, written separately, and where an open redirect is
 * just as possible.
 *
 * So this file asserts the ROUTE's property, not the helper's:
 *
 *   every single redirect this handler can emit, on every branch, points at this
 *   origin. Nothing derived from `?next=` ever becomes an authority.
 *
 * `createClient` is mocked rather than exercised. What is under test is the route's
 * decision boundary: which redirect it chooses, and what it puts in it. The real
 * client opens a cookie-backed Supabase session, which is not what this is about.
 */

const exchangeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchangeMock } }),
}));

const route = await import('@/app/auth/callback/route');

const ORIGIN = 'https://vip-averra.vercel.app';

function callback(query: string): NextRequest {
  return new NextRequest(`${ORIGIN}/auth/callback${query}`);
}

/** The `Location` a redirect response carries, parsed so assertions read clearly. */
function locationOf(response: { headers: Headers }): URL {
  const value = response.headers.get('location');
  if (!value) throw new Error('response carried no Location header');
  return new URL(value);
}

/**
 * Destinations an attacker would supply in `?next=` so that the redirect lands on
 * a look-alike page AFTER the user has signed in - which is the phishing primitive,
 * not a nuisance. The signed-in session is what makes it worth doing.
 */
const HOSTILE_NEXT = [
  'https://evil.com/dashboard',
  'http://evil.com',
  '//evil.com',
  '/\\evil.com',
  '/\\/\\/evil.com',
  'javascript:alert(document.cookie)',
  'data:text/html,<script>alert(1)</script>',
  'https://averra.name.ng.evil.com',
  '  //evil.com  ',
  '/\t/evil.com',
  'evil.com',
] as const;

beforeEach(() => {
  exchangeMock.mockReset();
  exchangeMock.mockResolvedValue({ data: {}, error: null });
  // The route logs the underlying Supabase failure. Silence it so a deliberately
  // failed exchange does not fill the test output; the assertions are on the
  // redirect, not on the log.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth callback cannot be used as an open redirect', () => {
  // THE regression. `safeNext` alone would not catch a regression where the route
  // stopped calling it, or where a future edit appended the raw parameter.
  it.each(HOSTILE_NEXT)('never leaves this origin for %o', async (hostile) => {
    const response = await route.GET(callback(`?code=abc123&next=${encodeURIComponent(hostile)}`));
    const location = locationOf(response);

    expect(location.origin).toBe(ORIGIN);
    expect(location.hostname).not.toBe('evil.com');
  });

  it('lands on the dashboard for every hostile destination', async () => {
    // Not merely "some same-origin URL". A hostile `next` must not produce a
    // same-origin URL either - `/%2F%2Fevil.com` and `/dashboard/evil.com` are
    // both same-origin and both wrong.
    for (const hostile of HOSTILE_NEXT) {
      const response = await route.GET(
        callback(`?code=abc123&next=${encodeURIComponent(hostile)}`),
      );

      expect(locationOf(response).pathname).toBe('/dashboard');
    }
  });

  it('reports the population, not a bare count', () => {
    // AGENTS.md: a check whose predicate silently matches nothing reads as "0 bad"
    // and gets reported as assurance. This asserts the corpus itself is real.
    expect(HOSTILE_NEXT.length).toBeGreaterThanOrEqual(10);
  });
});

describe('auth callback failure sends the user somewhere honest', () => {
  it('redirects to sign-in with an allowlisted code when the exchange fails', async () => {
    // The common real failure: the link expired or was already used. Before
    // CR-0040 the sign-in page ignored this code entirely, so the user saw an
    // ordinary sign-in form and no explanation - indistinguishable from the site
    // having ignored them.
    exchangeMock.mockResolvedValue({ data: null, error: { message: 'expired' } });

    const response = await route.GET(callback('?code=stale'));
    const location = locationOf(response);

    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('error')).toBe('auth_callback_failed');
  });

  it('redirects to sign-in when no code was supplied at all', async () => {
    const response = await route.GET(callback(''));

    expect(locationOf(response).pathname).toBe('/sign-in');
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('does NOT carry the caller-supplied destination onto the error path', async () => {
    // The error redirect is hardcoded, and that is load-bearing. If someone later
    // "improves" it to `/sign-in?error=...&next=${next}` the raw parameter would be
    // appended - and the failure branch would become the open redirect the success
    // branch was hardened against.
    exchangeMock.mockResolvedValue({ data: null, error: { message: 'expired' } });

    const response = await route.GET(
      callback('?code=stale&next=' + encodeURIComponent('https://evil.com')),
    );
    const location = locationOf(response);

    expect(location.searchParams.get('next')).toBeNull();
    expect(location.href).not.toContain('evil.com');
  });

  it('keeps every failure redirect on this origin too', async () => {
    exchangeMock.mockResolvedValue({ data: null, error: { message: 'expired' } });

    for (const hostile of HOSTILE_NEXT) {
      const response = await route.GET(callback(`?code=stale&next=${encodeURIComponent(hostile)}`));

      expect(locationOf(response).origin).toBe(ORIGIN);
    }
  });

  it('still lands the user with an explanation they can act on', async () => {
    // Closes the loop with the sign-in allowlist: the code this route emits must
    // be one the page actually knows how to explain, or the two halves drift.
    const { authErrorMessage } = await import('@/lib/auth/errors');
    exchangeMock.mockResolvedValue({ data: null, error: { message: 'expired' } });

    const response = await route.GET(callback('?code=stale'));
    const code = locationOf(response).searchParams.get('error');

    expect(authErrorMessage(code)).toMatch(/could not be completed/i);
  });
});
