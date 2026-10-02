'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { errorFields } from '@/lib/observability/errors';

// Account creation. This creates an AUTH identity and a PROFILE row. It does not
// create a wallet, a balance, a reward or an entitlement: those are financial
// state and are only ever produced by the ledger (doc 11 IDENTITY, law 1).

const signUpSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(200, 'Password is too long.'),
  displayName: z.string().trim().min(1, 'Choose a display name.').max(60),
});

export type SignUpResult =
  | { ok: true; requiresEmailConfirmation: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function signUpAction(
  _prev: SignUpResult | null,
  formData: FormData,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password, displayName } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error) {
    // Do not reveal whether an account exists for this address. Supabase's
    // message is passed through only where it is safe and generic.
    const message = error.message.includes('already registered')
      ? 'That address cannot be used. Try signing in instead.'
      : 'Account creation failed. Please try again.';

    return { ok: false, error: message };
  }

  const userId = data.user?.id;

  if (userId) {
    // The profile is created with the service role because the new user has no
    // session yet, so RLS would otherwise block their own insert.
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();

    const { error: profileError } = await admin.rpc('ensure_my_profile', {
      p_user_id: userId,
      p_display_name: displayName,
    });

    if (profileError) {
      console.error('[auth] profile creation failed', errorFields(profileError, { userId }));
    }
  }

  return {
    ok: true,
    // When email confirmation is enabled there is no session yet, and the UI
    // must say so rather than pretending the user is signed in.
    requiresEmailConfirmation: data.session === null,
  };
}
