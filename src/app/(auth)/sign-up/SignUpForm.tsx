'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { signUpAction, type SignUpResult } from '../actions';
import { TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Creating account…' : 'Create account'}
    </Button>
  );
}

export function SignUpForm() {
  return (
    // `useSearchParams` forces a client boundary, so the ?ref= read needs a
    // Suspense boundary. Rendering without the field would silently drop every
    // shared link.
    <Suspense fallback={<p className="text-sm text-ink-500">Loading…</p>}>
      <SignUpFormInner />
    </Suspense>
  );
}

function SignUpFormInner() {
  const [state, formAction] = useActionState<SignUpResult | null, FormData>(signUpAction, null);
  // Doc 39 ATTRIBUTION. A referral link carries ?ref=CODE, so the code is prefilled
  // rather than asked for. It stays EDITABLE, because a prefilled value the user
  // cannot see is a value they cannot correct.
  const searchParams = useSearchParams();
  const referredBy = searchParams.get('ref') ?? '';

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-700">
          {state.requiresEmailConfirmation
            ? 'Check your inbox to confirm your email address, then sign in.'
            : 'Your account is ready.'}
        </p>

        {state.referralNotice ? (
          <p role="status" className="text-sm leading-relaxed text-ink-500">
            {state.referralNotice}
          </p>
        ) : null}

        <Link href="/sign-in" className="text-sm font-medium text-brand-700 underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  const fieldError = (field: string): string | undefined =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <TextInput
        id="displayName"
        name="displayName"
        type="text"
        autoComplete="nickname"
        required
        maxLength={60}
        label="Display name"
        error={fieldError('displayName')}
      />

      <TextInput
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        label="Email address"
        error={fieldError('email')}
      />

      {referredBy ? (
        <div className="rounded-tile border border-brand-100 bg-brand-100/40 px-3 py-2">
          <p className="text-xs leading-relaxed text-brand-800">
            You were invited with a referral code. It is applied to your account automatically.
          </p>
        </div>
      ) : null}

      <TextInput
        id="referralCode"
        name="referralCode"
        type="text"
        defaultValue={referredBy}
        maxLength={20}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        label="Referral code"
        hint="Optional. Only applied when you create your account."
        error={fieldError('referralCode')}
      />

      <TextInput
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        label="Password"
        hint="At least 8 characters."
        error={fieldError('password')}
      />

      {state && !state.ok ? (
        <p role="alert" className="rounded-tile bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />

      <p className="text-sm text-ink-500">
        Already registered?{' '}
        <Link href="/sign-in" className="font-medium text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
