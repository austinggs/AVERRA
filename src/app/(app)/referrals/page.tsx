import { requireUser } from '@/lib/auth/session';
import { getReferralOverview } from '@/lib/referrals/overview';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';

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

const STATUS_COPY: Record<string, string> = {
  ATTRIBUTED: 'Recorded. Nothing earned yet.',
  QUALIFIED: 'Qualified. A reward has been created.',
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
  const shareLink = overview.code
    ? `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/sign-up?ref=${overview.code}`
    : null;

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
              {overview.thresholdMinor
                ? `When someone you refer reaches ${overview.thresholdMinor} in attributed earnings, the referral qualifies and a reward is created for you.`
                : 'Share your code. A referral earns nothing until the person you refer completes qualifying activity.'}
            </p>

            {shareLink ? (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-white/70">
                  Your invite link
                </p>
                <p className="mt-1 break-all font-mono text-sm text-white">{shareLink}</p>
                <p className="mt-3 text-xs leading-relaxed text-white/80">
                  Send this link to the person you want to invite. When they open it, the code is
                  already filled in for them. The code only works at signup — it cannot be added to
                  an account afterwards, which is what stops someone joining now and claiming a
                  referral later.
                </p>
              </>
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
              {overview.referrals.map((referral) => (
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
                  </Card>
                </li>
              ))}
            </ul>
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
