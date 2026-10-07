import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NEXT_PUBLIC_SITE_URL is required, not optional, and that is the point of this file.
//
// The regression: the referral page built its share link as
// `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/sign-up?ref=CODE`. Unset, that produced the
// relative string `/sign-up?ref=CODE`, which throws no error and does nothing once pasted
// into a chat app. The variable was in neither `.env.example` nor this schema, so nothing
// warned about it.
//
// These tests assert the SHAPE of the failure, not just that a value is returned. A test
// that only checked "returns the origin" would have passed against the buggy code.

describe('public env validation', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://averra.name.ng';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('returns the site origin when every value is present', async () => {
    const { getPublicEnv } = await import('@/lib/env');

    expect(getPublicEnv().NEXT_PUBLIC_SITE_URL).toBe('https://averra.name.ng');
  });

  it('THROWS when NEXT_PUBLIC_SITE_URL is missing, rather than defaulting to empty', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { getPublicEnv } = await import('@/lib/env');

    // This is the assertion that distinguishes the fix from the original code. An
    // optional/empty fallback would return '' here and pass a weaker test.
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('THROWS when NEXT_PUBLIC_SITE_URL is not a URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'not-a-url';
    const { getPublicEnv } = await import('@/lib/env');

    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SITE_URL is not a valid URL/);
  });

  it('accepts a site origin that is not a bare origin root', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.averra.name.ng';
    const { getPublicEnv } = await import('@/lib/env');

    expect(getPublicEnv().NEXT_PUBLIC_SITE_URL).toBe('https://app.averra.name.ng');
  });
});