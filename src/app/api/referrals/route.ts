import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// GET  /api/referrals  the caller's own referral code and history
// POST /api/referrals  attribute a code to the caller
//
// A USER MAY ONLY ATTRIBUTE THEIR OWN REFERRAL. There is no route that awards,
// qualifies or rewards one. Those are server-side, and
// `reward_referral` is service_role only (doc 39, law 10).
//
// Doc 39 TRANSPARENCY: the response explains why a referral is pending, WITHOUT
// exposing internal risk signals. `status_reason` is written for the user; the
// `game_risk_signals` and fraud tables are never joined here.

export const GET = route(async ({ user }) => {
  const admin = createAdminClient();

  // Routed through `public.get_referral_overview`, NOT `.from('referrals')`.
  // The `app` schema is not exposed through the Data API, and the wrapper scopes
  // every field to `p_user_id` in the database.
  const { data, error } = await admin.rpc('get_referral_overview', { p_user_id: user!.id });

  if (error) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not read your referral data.' } },
      { status: 500 },
    );
  }

  const summary = (data ?? {}) as {
    code: string | null;
    thresholdMinor: string | null;
    isActive: boolean;
    counts: { total: number; qualified: number; rewarded: number };
    referrals: Array<{
      id: string;
      status: string;
      reason: string | null;
      qualifiedAt: string | null;
      createdAt: string;
    }>;
  };

  return NextResponse.json({
    code: summary.code,
    thresholdMinor: summary.thresholdMinor,
    isActive: summary.isActive,
    counts: summary.counts,
    // Doc 39: the user can see the status and WHY, but no risk signal. The
    // wrapper joins no risk table, so there is nothing to filter out here.
    referrals: summary.referrals,
  });
});

const createSchema = z.object({
  code: z.string().trim().min(4).max(16),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Enter a valid referral code.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  const { error } = await admin.rpc('attribute_referral', {
    p_referee_user_id: user!.id,
    p_code: parsed.data.code,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    if (message.includes('cannot refer themselves')) {
      throw new RouteError('validation_failed', 'You cannot use your own referral code.');
    }

    if (message.includes('unknown referral code')) {
      throw new RouteError('not_found', 'That referral code is not valid.');
    }

    console.error('[api] attribute referral failed', { correlationId, error: message });
    throw new RouteError('internal_error', 'Could not apply that referral code.');
  }

  return NextResponse.json(
    {
      applied: true,
      message:
        'Referral recorded. No reward is created yet: a referral only qualifies once the ' +
        'person you referred completes qualifying activity.',
    },
    { status: 201 },
  );
});
