// Route protection.
//
// This gate decides only WHETHER a request may reach a page. It never decides
// anything financial. A page that renders money also re-checks the session and
// the capability server-side, because a proxy match is a navigation
// convenience, not an authorization decision (law 3, law 17, doc 71 V7 law 1).
//
// The public-path decision itself lives in `@/lib/auth/public-paths` so it can be
// unit tested. `isPublicPath` is imported rather than duplicated, because a copy here
// would be a second allowlist that could drift from the tested one - and the one entry
// that matters today is the provider callback, whose absence redirected every CPX
// postback to a login page.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
import { isPublicPath } from '@/lib/auth/public-paths';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const response = await updateSession(request);

  if (isPublicPath(pathname)) {
    return response;
  }

  // The proxy refreshed the auth cookies; re-read them from the outgoing
  // response so the check below reflects the refreshed session.
  const hasSessionCookie = response.cookies.getAll().length > 0;
  const incomingAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.value.length > 0);

  if (!hasSessionCookie && !incomingAuthCookie) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
