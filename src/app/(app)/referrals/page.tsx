import { requireUser } from '@/lib/auth/session';
import { getPublicEnv } from '@/lib/env';
import { getReferralOverview } from '@/lib/referrals/overview';
import { formatAmount, mapRewardState } from '@/lib/referrals/present';
import { CopyButton } from '@/components/referrals/CopyButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';
import { MoneyState } from '@/components/ui/MoneyState';

export const metadata = { title: 'Referrals - Averra' };

// The referral surface (doc 39).
//
// THE HONEST FRAMING, STATED UP FRONT
//
// Doc 39 QUALIFICATION: a referral reward requires configured qualifying
// behaviour and "cannot be triggered merely by account creation". So this page
// never implies that sharing a link pays anything. It says what actually
// qualifies, and it shows each referral's status.
//
// Doc 39 TRANSPARENCY: the user sees status and reason. Internal risk signals are
// never shown, and are never queried here.
//
// AMOUNTS ARE SHOWN AS RAW MINOR UNITS
//
// Matching the dashboard and wallet: the minor-unit scale is configuration, so this
// page does not rescale to naira. A referral reward is presented identically to
// every other amount, so a user never sees two renderings of the same money.
//
// QUALIFIED IS NOT "PAID"
//
// The wording is deliberately distinct from REWARDED. Migration 053 moved the
// payout out of the qualifying transaction into the outbox worker, so a QUALIFIED
// referral is one whose reward is DUE, possibly not yet created. Saying "a reward
// has been created" there would be a claim the database does not support yet.

const STATUS_COPY: Record<string, string> = {
  ATTRIBUTED: 'Recorded. Nothing earned yet.',
  QUALIFIED: 'Qualified. Your reward is being added to your earned balance.',
  REWARDED: 'Reward created and added to your earned balance.',
  REJECTED: 'Not eligible.',
};

// Referral read model is UNCHANGED by migration 047: `public.get_referral_overview`
// already returns the caller's code, their referrals and their counts. What changed is
// that a code now EXISTS, so this page has something real to show.
export default async function ReferralsPage() {
  // Referral state is read server-side so the page cannot render a stale
  // "qualified" badge from a cached client fetch.
  const user = await requireUser();
  const overview = await getReferralOverview(user.id);

  // Doc 39 TRANSPARENCY: the user sees status and reason. Internal risk signals are
  // never shown, and are never queried here.
  // A share link MUST be absolute. It gets pasted into a chat app, where a relative
  // `/sign-up?ref=...` resolves against nothing and quietly earns nobody.
  //
  // The origin comes from validated env rather than a bare `process.env` read, so a
  // missing NEXT_PUBLIC_SITE_URL fails loudly here instead of shipping a dead link.
  // The trailing slash is stripped because the origin may legitimately be declared as
  // `https://site.ng/`, which would otherwise produce `//sign-up`.
  const origin = getPublicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  const shareLink = overview.code ? `${origin}/sign-up?ref=${overview.code}` : null;

  // Every amount on this page is denominated in the unit the server reported, so a
  // threshold and a reward can never be labelled with different units.
  const unit = overview.unit;

  return (
    <div>
      <PageHeader
        title="Referrals"
        description="Share your code. When someone joins with it, they are recorded as yours. A referral only earns once the person you referred completes qualifying activity — signing up alone pays nothing."
      />

      <Card tone="brand" className="mt-6">
        <h2 className="text-base font-bold tracking-tight">Your referral code</h2>

        {overview.code ? (
          <>
            <p className="mt-3 font-mono text-2xl font-bold tracking-widest">{overview.code}</p>

            <p className="mt-3 text-sm leading-relaxed text-white/85">
              {overview.thresholdMinor && overview.rewardMinor
                ? `When someone you refer reaches ${formatAmount(
                    overview.thresholdMinor,
                    unit,
                  )} in confirmed transactions, you earn ${formatAmount(
                    overview.rewardMinor,
                    unit,
                  )}.`
                : 'Share your code. A referral earns nothing until the person you refer completes qualifying activity.'}
            </p>

            {shareLink ? (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-white/70">
                  Your invite link
                </p>
                <input
                  id="invite-link"
                  readOnly
                  value={shareLink}
                  className="mt-1 w-full rounded-tile border border-white/25 bg-white/10 px-3 py-2 font-mono text-sm text-white"
                  aria-label="Your invite link"
                />
                <div className="mt-2">
                  <CopyButton value={shareLink} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-white/80">
                  When they open this link the code is already filled in. The code only works at
                  signup — it cannot be added to an account afterwards, which is what stops someone
                  joining now and claiming a referral later.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-white/85">
              You do not have a referral code yet. Codes are issued when the referral programme
              opens.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-white/75">
              Until then there is nothing to share, and sharing a link would earn nothing: a
              referral only qualifies once the person you referred completes qualifying activity.
            </p>
          </>
        )}
      </Card>

      <section className="mt-8">
        <SectionHeading title="Your referrals" />

        {overview.referrals.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No referrals yet"
              description="Share your code to get started. A referral earns nothing until the person you refer completes qualifying activity."
            />
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Card>
                <p className="text-xs font-medium text-ink-500">Total</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {overview.counts.total}
                </p>
              </Card>
              <Card>
                <p className="text-xs font-medium text-ink-500">Qualified</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {overview.counts.qualified}
                </p>
              </Card>
              <Card>
                <p className="text-xs font-medium text-ink-500">Rewarded</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
                  {overview.counts.rewarded}
                </p>
              </Card>
            </div>

            <ul className="mt-4 space-y-3">
              {overview.referrals.map((referral) => {
                // Progress is a plain ratio of two integers the server sent. It is a
                // DISPLAY of database state, never a decision: whether the threshold
                // is met is `referral.status`, which the server set.
                const progress =
                  referral.status === 'ATTRIBUTED' && overview.thresholdMinor
                    ? Math.min(1, referral.qualifiedValueMinor / overview.thresholdMinor)
                    : null;

                return (
                  <li key={referral.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-ink-700">
                            {STATUS_COPY[referral.status] ?? referral.status}
                          </p>
                          <p className="mt-1 text-xs text-ink-500">
                            Referred {new Date(referral.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Pill
                          tone={
                            referral.status === 'REWARDED'
                              ? 'brand'
                              : referral.status === 'REJECTED'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {referral.status.toLowerCase()}
                        </Pill>
                      </div>

                      {progress !== null && progress > 0 ? (
                        <div className="mt-3">
                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progress * 100)}
                            aria-label="Progress toward the referral threshold"
                            className="h-2 w-full overflow-hidden rounded-full bg-ink-100"
                          >
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${Math.round(progress * 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-ink-500">
                            {formatAmount(referral.qualifiedValueMinor, unit)} of{' '}
                            {formatAmount(overview.thresholdMinor ?? 0, unit)}
                          </p>
                        </div>
                      ) : null}

                      {referral.reason ? (
                        <p className="mt-2 text-xs leading-relaxed text-ink-500">
                          {referral.reason}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>

            {overview.rewards.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-sm font-semibold text-ink-900">Rewards earned</h2>

                <ul className="mt-3 space-y-3">
                  {overview.rewards.map((reward) => {
                    // The tone is DERIVED from the mapped presentation state, never
                    // from the raw database enum. `settled` is the only brand green,
                    // so a green number always means credited money.
                    const rewardView = mapRewardState(reward.state);

                    return (
                      <li key={reward.rewardId}>
                        <Card>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              {/* The reward STATE, not a bare number: a pending reward
                                  is not money the user can spend. */}
                              <MoneyState
                                state={rewardView}
                                amount={formatAmount(reward.amountMinor, reward.unit)}
                                unit={reward.unit}
                              />
                              <p className="mt-1 text-xs text-ink-500">
                                {new Date(reward.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <Pill
                              tone={
                                rewardView === 'settled'
                                  ? 'brand'
                                  : rewardView === 'failed'
                                    ? 'danger'
                                    : 'neutral'
                              }
                            >
                              {reward.state.toLowerCase()}
                            </Pill>
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  A reward becomes withdrawable once it settles. It is added to your Earned Reward
                  Balance, which is separate from your deposit balance.
                </p>
              </section>
            ) : null}
          </>
        )}
      </section>

      <Card tone="sunken" className="mt-8">
        <p className="text-xs leading-relaxed text-ink-500">
          We do not reward self-referral, and we do not pay for an account that only exists. A
          referral reward is created by the Reward Engine from a funded budget, so it can be held or
          reversed like any other reward.
        </p>
      </Card>
    </div>
  );
}
