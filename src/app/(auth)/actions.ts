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
  // Doc 39 ATTRIBUTION: "Referral code/link maps a NEW ACCOUNT to a referrer."
  // Optional and never fatal - see the attribution block below.
  referralCode: z
    .string()
    .trim()
    .max(20)
    .transform((v) => (v.length === 0 ? undefined : v.toUpperCase()))
    .optional(),
});

export type SignUpResult =
  | { ok: true; requiresEmailConfirmation: boolean; referralNotice?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function signUpAction(
  _prev: SignUpResult | null,
  formData: FormData,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName'),
    referralCode: formData.get('referralCode') ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password, displayName, referralCode } = parsed.data;
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

  // Set when a code was supplied but could not be used. The account is created
  // regardless: a typo in a referral field must never cost somebody their signup.
  let referralNotice: string | undefined;

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

    // Doc 39 ATTRIBUTION. Attributed AFTER the profile exists, and only when a code
    // was actually supplied.
    //
    // A referral is recorded here and pays NOTHING. `attribute_referral` writes
    // ATTRIBUTED; qualification and reward are separate server-driven steps, which
    // is how doc 39's "cannot be triggered merely by account creation" is enforced.
    //
    // Failures are reported to the user rather than swallowed. Silently dropping a
    // code somebody deliberately shared is worse than telling them it did not work.
    if (referralCode) {
      const { error: attributionError } = await admin.rpc('attribute_referral', {
        p_referee_user_id: userId,
        p_code: referralCode,
      });

      if (attributionError) {
        const message = String(attributionError.message ?? '');

        if (/cannot refer themselves/i.test(message)) {
          referralNotice =
            'Your account was created, but that referral code is your own, so it was not used.';
        } else {
          referralNotice =
            'Your account was created, but that referral code was not recognised. You can ask whoever shared it to check it.';
        }

        console.error(
          '[auth] referral attribution failed',
          errorFields(attributionError, { userId, hasCode: true }),
        );
      }
    }
  }

  return {
    ok: true,
    // When email confirmation is enabled there is no session yet, and the UI
    // must say so rather than pretending the user is signed in.
    requiresEmailConfirmation: data.session === null,
    referralNotice,
  };
}
