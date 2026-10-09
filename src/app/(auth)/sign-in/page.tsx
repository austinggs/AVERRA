import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { authErrorMessage } from '@/lib/auth/errors';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { Card, Pill } from '@/components/ui/Card';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in - Averra' };

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
  // code exchange fails. Until CR-0040 nothing read that parameter, so a user
  // whose link had expired - the single most common failure, and the one that
  // looks most like our fault - was shown an ordinary sign-in form and no
  // explanation at all. They would reasonably conclude the site had ignored them.
  //
  // `authErrorMessage` is an ALLOWLIST lookup, never an echo of the parameter.
  // See src/lib/auth/errors.ts.
  const code = (await searchParams).error;
  const message = authErrorMessage(code);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <BrandLockup href="/" className="mb-8" />

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
