'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { signInAction, type SignInResult } from '../auth-actions';
import { TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function SignInForm() {
  const [state, formAction] = useActionState<SignInResult | null, FormData>(signInAction, null);

  return (
    <form action={formAction} className="space-y-4">
      <TextInput
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        label="Email address"
      />

      <TextInput
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        label="Password"
      />

      {state && !state.ok ? (
        <p role="alert" className="rounded-tile bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />

      <p className="text-sm text-ink-500">
        No account yet?{' '}
        <Link href="/sign-up" className="font-medium text-brand-700 underline">
          Create one
        </Link>
      </p>
    </form>
  );
}
