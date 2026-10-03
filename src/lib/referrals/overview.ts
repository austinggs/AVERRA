import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { describeError } from '@/lib/observability/errors';

// Referral read model (doc 39).
//
// PURPOSE OF THIS MODULE
//
// The page and the API both need the same shape, and both must be equally
// careful about what they expose. Doc 39 TRANSPARENCY requires the user to see
// "referral status and why a reward is pending or rejected without seeing
// sensitive risk signals".
//
// So the SELECT list below is exhaustive and deliberate. It names `status` and
// `status_reason` and nothing else. There is deliberately NO join to any risk,
// fraud, or device-signal table, because the correct way to keep a signal out of
// a user-facing read is to never query it.

export type ReferralOverview = {
  code: string | null;
  thresholdMinor: number | null;
  programmeOpen: boolean;
  /** What one successful referral is worth. A term of the offer, not a secret. */
  rewardMinor: number;
  /** The unit every amount on this page is denominated in. */
  unit: string;
  counts: {
    total: number;
    qualified: number;
    rewarded: number;
  };
  referrals: Array<{
    id: string;
    status: string;
    reason: string | null;
    /** NET qualifying value, so it is always <= the gross that produced it. */
    qualifiedValueMinor: number;
    qualifiedAt: string | null;
    createdAt: string;
  }>;
  rewards: Array<{
    referralId: string;
    rewardId: string;
    amountMinor: number;
    unit: string;
    state: string;
    createdAt: string;
  }>;
};

export async function getReferralOverview(userId: string): Promise<ReferralOverview> {
  const admin = createAdminClient();

  // Routed through `public.get_referral_overview`, NOT `.from('referrals')`.
  //
  // Two reasons, and the second is the important one:
  //
  //  1. The `app` schema is not exposed through the Data API, so a PostgREST read
  //     of it fails with PGRST205 regardless of RLS.
  //  2. The wrapper selects exactly four user-facing columns and joins NO risk,
  //     fraud or device table. Doc 39 TRANSPARENCY requires the user to see
  //     "referral status and why a reward is pending or rejected without seeing
  //     sensitive risk signals". The reliable way to keep a signal out of a read
  //     is to never query it, which is enforced here in the database rather than
  //     by filtering afterwards.
  const { data, error } = await admin.rpc('get_referral_overview', { p_user_id: userId });

  if (error) {
    throw new Error(`referrals: unable to read (${describeError(error)})`);
  }

  const summary = (data ?? {}) as {
    code: string | null;
    thresholdMinor: number | null;
    programmeOpen: boolean;
    rewardMinor: number;
    unit: string;
    counts: { total: number; qualified: number; rewarded: number };
    referrals: ReferralOverview['referrals'];
    rewards: ReferralOverview['rewards'];
  };

  return {
    code: summary.code ?? null,
    thresholdMinor: summary.thresholdMinor ?? null,
    programmeOpen: summary.programmeOpen ?? false,
    rewardMinor: summary.rewardMinor ?? 0,
    unit: summary.unit ?? 'NGN-kobo',
    referrals: summary.referrals ?? [],
    rewards: summary.rewards ?? [],
    counts: summary.counts ?? { total: 0, qualified: 0, rewarded: 0 },
  };
}
