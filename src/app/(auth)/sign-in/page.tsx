import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { Card, Pill } from '@/components/ui/Card';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in - Averra' };

/**
 * Copy for the codes `/auth/callback` can redirect with.
 *
 * Keyed by an ALLOWLIST, never by echoing `searchParams.error` back. An unknown
 * code must not be reflected into the page: the parameter is attacker-supplied,
 * so interpolating it would put whatever text was sent into the sign-in form, and
 * an unrecognised code still needs to tell the user something happened.
 */
const AUTH_ERRORS: Record<string, string> = {
  auth_callback_failed:
    'That sign-in link could not be completed. It may have expired or already been used.',
  otp_expired: 'That verification link has expired. Request a new one below.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();

  if (user) {
    redirect('/dashboard');
  }

  // The callback redirects here with `?error=auth_callback_failed` whenever the
  // code exchange fails. Until now nothing read that parameter, so a user whose
  // link had expired - the single most common failure, and the one that looks
  // most like our fault - was shown an ordinary sign-in form and no explanation
  // at all. They would reasonably conclude the site had simply ignored them.
  const code = (await searchParams).error;
  const message = code ? (AUTH_ERRORS[code] ?? 'We could not complete that sign-in. Please try again.') : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-tile bg-brand-500 text-sm font-black text-white"
        >
          A
        </span>
        <span className="text-base font-bold tracking-tight text-ink-900">Averra</span>
      </Link>

      <Card className="w-full max-w-md">
        <Pill tone="brand">Welcome back</Pill>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink-900">Sign in</h1>

        {message ? (
          <p
            role="alert"
            className="mt-3 rounded-pill border border-danger-200 bg-danger-50 px-4 py-3 text-sm leading-relaxed text-danger-700"
          >
            {message}
          </p>
        ) : null}

        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Sign in to view your balances, complete tasks and track your rewards.
        </p>

        <div className="mt-6">
          <SignInForm />
        </div>
      </Card>
    </main>
  );
}
