import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// Authentication and authorization helpers.
//
// IMPORTANT: authorization NEVER trusts the browser. A role claim in client
// state, a query parameter, or a request body is evidence of nothing. Every
// privileged action re-checks the capability server-side against app.admin_users
// (law 71 V7 admin laws 1 and 2: "Admin UI never authorizes a financial
// mutation by itself").

export type SessionUser = {
  id: string;
  email: string | null;
};

/**
 * The current signed-in user, or null. Cached per request so repeated calls in
 * one render do not re-verify the token.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  // getClaims verifies the JWT signature against the Supabase JWKS. It does not
  // hit the database, and it is the trustworthy source of the subject claim.
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  const claims = data.claims as Record<string, unknown>;

  return {
    id: String(data.claims.sub),
    email: typeof claims.email === 'string' ? claims.email : null,
  };
});

/**
 * Requires a signed-in user. Redirects to sign-in otherwise. Use this in Server
 * Components and pages that render user-specific or financial data.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect('/sign-in');
  }

  return user;
}

/**
 * Loads the profile row. Returns null when the user has no profile yet, which is
 * a legitimate state: a new signup is not an error.
 *
 * Routed through `public.get_my_profile`, NOT `.from('profiles')`. The `app`
 * schema is deliberately not exposed through the Data API, so a PostgREST read
 * of it fails regardless of RLS. See AGENTS.md.
 */
export async function getProfile(userId: string) {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('get_my_profile', { p_user_id: userId });

  if (error) {
    // Every authenticated page calls this through the shell, so a failure here
    // must be legible rather than silent.
    console.error('[auth] profile read failed', errorFields(error));
    return null;
  }

  if (!data) return null;

  // The wrapper returns camelCase JSON; map back to the shape callers expect.
  const row = data as {
    id: string;
    displayName: string | null;
    accountStatus: string;
    createdAt: string;
  };

  return {
    id: row.id,
    display_name: row.displayName,
    account_status: row.accountStatus,
    created_at: row.createdAt,
  };
}

export type ProfileRow = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

/**
 * The three states an account can be in, from the user's point of view.
 *
 * `UNPROVISIONED` exists because it is NOT the same as `RESTRICTED`, and conflating
 * them is what made every user see "Account restricted". A missing profile row is a
 * setup gap; a SUSPENDED account is a decision somebody made. The two need different
 * words, different actions, and different support paths.
 */
export type AccountAccessState = 'ACTIVE' | 'RESTRICTED' | 'UNPROVISIONED';

/**
 * Classifies the account.
 *
 * `null` means no profile row exists. Migration 044's trigger makes that close to
 * impossible for new signups, but it is still a distinct state rather than a
 * restricted one, because the correct response is "finish setting up", not "contact
 * support about a suspension you never received".
 */
export function accountAccessState(profile: ProfileRow | null): AccountAccessState {
  if (!profile) return 'UNPROVISIONED';
  return profile.account_status === 'ACTIVE' ? 'ACTIVE' : 'RESTRICTED';
}

/** A suspended or closed account must not reach the earning or wallet surfaces. */
export function isAccountActive(profile: ProfileRow | null): boolean {
  return accountAccessState(profile) === 'ACTIVE';
}

/**
 * Best-effort user lookup for server contexts that already hold a verified
 * user object. Never used to authorize.
 */
export async function loadUserById(userId: string): Promise<User | null> {
  const supabase = await createClient();

  const { data } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: null }));

  return data?.user ?? null;
}
