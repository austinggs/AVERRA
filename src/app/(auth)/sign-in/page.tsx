import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { Card, Pill } from '@/components/ui/Card';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in - Averra' };

export default async function SignInPage() {
  const user = await getSessionUser();

  if (user) {
    redirect('/dashboard');
  }

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
