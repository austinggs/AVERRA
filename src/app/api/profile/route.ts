import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// PATCH /api/profile
//
// The display name, and nothing else.
//
// `account_status` has NO route. It is written by the provisioning trigger and by
// operators, never by a request. There is no parameter here that could reach it, which
// is the point: a settings endpoint that accepts an account status is one careless
// deploy away from letting a user un-suspend themselves (law 44, law 8).
//
// p_user_id comes from the verified session claim and is never read from the body, so
// this cannot be pointed at somebody else's profile.

const updateSchema = z.object({
  displayName: z.string().trim().min(1, 'A display name is required.').max(60),
});

export const PATCH = route(async ({ user, body, correlationId }) => {
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  // Routed through `public.update_my_display_name`, NOT `.from('profiles')`. The
  // `app` schema is not exposed through the Data API.
  const { data, error } = await admin.rpc('update_my_display_name', {
    p_user_id: user!.id,
    p_display_name: parsed.data.displayName,
  });

  if (error) {
    const message = String(error.message ?? '');

    // No profile row. Migration 044 makes this rare, but the message says what to do
    // rather than blaming the user for something they cannot fix.
    if (error.code === 'P0002' || /no profile for this account/i.test(message)) {
      throw new RouteError(
        'not_found',
        'Your profile is still being set up. Try again in a moment.',
      );
    }

    if (error.code === '23514') {
      throw new RouteError('validation_failed', 'That display name cannot be used.');
    }

    console.error('[api] update display name failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not save your display name.');
  }

  const profile = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json({
    profile: {
      id: profile?.id as string,
      displayName: profile?.display_name as string,
      updatedAt: profile?.updated_at as string,
    },
  });
});
