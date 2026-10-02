'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Password sign-in. Errors are deliberately generic: distinguishing "no such
// account" from "wrong password" would let an unauthenticated caller enumerate
// which addresses are registered (doc 53 SECURITY ARCHITECTURE).

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signInAction(
  _prev: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { ok: false, error: 'Enter your email address and password.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { ok: false, error: 'Those sign-in details were not recognised.' };
  }

  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
