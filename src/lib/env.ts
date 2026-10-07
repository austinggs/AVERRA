import { z } from 'zod';

// Client-safe environment. NEVER add secrets here - anything in this file can
// reach the browser bundle. Server secrets live in env.server.ts.
//
// VALIDATION IS LAZY, NOT AT IMPORT TIME.
//
// An earlier version parsed and threw at module scope. That looks stricter, but
// it breaks `next build`: page-data collection imports every route module in a
// worker whose environment may legitimately lack deployment values, so a
// missing key failed the build with a confusing "Failed to collect page data
// for /sign-up" rather than a clear configuration message.
//
// Lazy validation keeps the fail-fast property where it matters - the first
// actual use - and lets the build compile independently of deployment config.
// An unconfigured app still refuses to serve requests; it just fails at use
// instead of at import.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.'),
  // The absolute origin used to build shareable links (referrals today).
  //
  // REQUIRED rather than optional, and that is deliberate. The referral page used to
  // read this as `process.env.NEXT_PUBLIC_SITE_URL ?? ''`, which silently degraded to a
  // relative `/sign-up?ref=CODE` when unset - no error, and a link that does nothing
  // once pasted into a chat app. A missing origin is a broken acquisition path, so it
  // now fails at first use like every other public value.
  NEXT_PUBLIC_SITE_URL: z.string().url('NEXT_PUBLIC_SITE_URL is not a valid URL.'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function loadPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid public environment: ${issues}`);
  }

  return parsed.data;
}

let cached: PublicEnv | null = null;

/** Lazily validated public environment. */
export function getPublicEnv(): PublicEnv {
  cached ??= loadPublicEnv();
  return cached;
}

/**
 * @deprecated Use {@link getPublicEnv}. Kept as a lazily-read object so existing
 * `publicEnv.X` call sites keep working without evaluating at import time.
 */
export const publicEnv: PublicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  },
  get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY(): string {
    return getPublicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  },
  get NEXT_PUBLIC_SITE_URL(): string {
    return getPublicEnv().NEXT_PUBLIC_SITE_URL;
  },
} as PublicEnv;
