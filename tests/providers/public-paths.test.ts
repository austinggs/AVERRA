import { describe, expect, it } from 'vitest';
import { isPublicPath, requiresSession } from '@/lib/auth/public-paths';

describe('isPublicPath', () => {
  it('keeps the sign-in and sign-up surfaces reachable', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/sign-up')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
  });

  it('keeps the public reviews surface reachable', () => {
    expect(isPublicPath('/reviews')).toBe(true);
    expect(isPublicPath('/reviews/some-review-id')).toBe(true);
  });

  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // CPX Research posts back server-to-server and has no Averra session. While the
  // callback path was absent from the allowlist, every postback returned
  // 307 -> /sign-in: the provider got an HTML login page, the ingest pipeline was never
  // reached, and provider_callbacks stayed empty with no error anywhere.
  it('reaches the provider callback without a session', () => {
    expect(isPublicPath('/api/providers/callbacks/cpx_research')).toBe(true);
    expect(isPublicPath('/api/providers/callbacks/reference')).toBe(true);
  });

  // Forgiving about a trailing slash, because a postback URL is configured by hand in
  // a vendor dashboard and `.../cpx_research/` is an easy thing to paste.
  it('tolerates a trailing slash on a callback path', () => {
    expect(isPublicPath('/api/providers/callbacks/cpx_research/')).toBe(true);
  });
});

// THE NEGATIVE CASES.
//
// Asserting only that the callback is public would pass just as happily if the whole
// API had been made public. These are the assertions that catch an over-broad
// allowlist, which is the actual risk of this change.
describe('provider callback allowlist is not over-broad', () => {
  it('keeps every OTHER api route behind a session', () => {
    for (const path of [
      '/api/perks',
      '/api/wallet',
      '/api/withdrawals',
      '/api/deposits',
      '/api/donations',
      '/api/admin/reviews',
      '/api/reviews',
    ]) {
      expect(requiresSession(path)).toBe(true);
    }
  });

  it('does not expose provider routes other than callbacks', () => {
    expect(requiresSession('/api/providers')).toBe(true);
    expect(requiresSession('/api/providers/anything-else')).toBe(true);
    expect(requiresSession('/api/providers/admin')).toBe(true);
  });

  // The pattern must not match a longer sibling segment. `/callbacksX` is a different
  // path and must stay private.
  it('does not match a path that merely starts with the same text', () => {
    expect(requiresSession('/api/providers/callbacksX/cpx_research')).toBe(true);
    expect(requiresSession('/api/providers/callbacks/admin/reset')).toBe(true);
  });

  // The provider segment must look like a provider CODE. This keeps a traversal-shaped
  // or arbitrary segment from being treated as public.
  it('requires the provider segment to look like a provider code', () => {
    expect(requiresSession('/api/providers/callbacks/')).toBe(true);
    expect(requiresSession('/api/providers/callbacks/a')).toBe(true);
    expect(requiresSession('/api/providers/callbacks/UPPERCASE')).toBe(true);
    expect(requiresSession('/api/providers/callbacks/has-a-dash')).toBe(true);
    expect(requiresSession('/api/providers/callbacks/has space')).toBe(true);
  });

  it('requires a segment beyond the bare callbacks path', () => {
    expect(requiresSession('/api/providers/callbacks')).toBe(true);
  });
});

describe('isPublicPath and requiresSession agree', () => {
  const paths = [
    '/',
    '/sign-in',
    '/reviews',
    '/reviews/abc',
    '/dashboard',
    '/api/providers/callbacks/cpx_research',
    '/api/providers/callbacks/cpx_research/',
    '/api/perks',
    '/api/providers/callbacks',
    '/api/providers/callbacks/BAD-CODE',
    '/wallet',
    '/settings',
  ];

  it('is a strict complement everywhere', () => {
    for (const path of paths) {
      expect(requiresSession(path)).toBe(!isPublicPath(path));
    }
  });
});
