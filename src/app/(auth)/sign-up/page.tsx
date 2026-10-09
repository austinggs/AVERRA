import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { Card, Pill } from '@/components/ui/Card';
import { SignUpForm } from './SignUpForm';

export const metadata = { title: 'Create account - Averra' };

export default async function SignUpPage() {
  const user = await getSessionUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <BrandLockup href="/" className="mb-8" />

      <Card className="w-full max-w-md">
        <Pill tone="brand">Free to join</Pill>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink-900">Create your account</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          No deposit is required to earn or to withdraw eligible rewards. A deposit is always
          optional and is kept separate from anything you earn.
        </p>

        <div className="mt-6">
          <SignUpForm />
        </div>
      </Card>
    </main>
  );
}
