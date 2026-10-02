import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorFields } from '@/lib/observability/errors';

// OAuth / magic-link callback. Exchanges the one-time code for a session, then
// redirects. The session itself is set in cookies by the SSR client.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  // Only allow same-origin relative redirects. An absolute URL here would be an
  // open redirect: an attacker could send a user to a look-alike site after
  // sign-in.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }

    console.error('[auth] code exchange failed', errorFields(error));
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
