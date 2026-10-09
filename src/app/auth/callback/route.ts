import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorFields } from '@/lib/observability/errors';
import { safeNext } from '@/lib/auth/next';

// OAuth / magic-link callback. Exchanges the one-time code for a session, then
// redirects. The session itself is set in cookies by the SSR client.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // An absolute URL here would be an open redirect: an attacker could send a user
  // to a look-alike site AFTER they have signed in, which is the phishing
  // primitive rather than a nuisance. `safeNext` fails closed to `/dashboard`.
  //
  // It used to be inlined as `startsWith('/') && !startsWith('//')`, which looks
  // like it blocks that and does not: it accepts `/\evil.com`, which browsers
  // normalise to a protocol-relative URL. See src/lib/auth/next.ts.
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error('[auth] code exchange failed', errorFields(error));
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
