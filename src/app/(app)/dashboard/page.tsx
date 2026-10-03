import { requireUser, getProfile, accountAccessState } from '@/lib/auth/session';
import { getWalletSummary } from '@/lib/wallet/summary';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, SectionHeading } from '@/components/ui/Card';
import { BalanceCard } from '@/components/ui/MoneyState';
import { ButtonLink } from '@/components/ui/Button';

export const metadata = { title: 'Dashboard - Averra' };

function formatMinor(amount: bigint): string {
  // Amounts are integer minor units. The minor-unit size is configuration; the
  // spec preserves the source asset and quantity rather than assuming a scale.
  return amount.toString(10);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);

  // THIRD STATE, THIRD MESSAGE.
  //
  // This used to be `if (!isAccountActive(profile))`, which evaluated a missing
  // profile row as "restricted" and told every affected user that their account was
  // suspended. A setup gap and a decision somebody made need different words.
  const access = accountAccessState(profile);

  if (access === 'UNPROVISIONED') {
    return (
      <div>
        <PageHeader title="Setting up your account" />
        <Card className="mt-6">
          <p className="text-sm leading-relaxed text-ink-700">
            We are still finishing setting up your account. This usually takes a moment and does not
            need anything from you. If it is still not ready in a few minutes, contact support and
            we will sort it out.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/dashboard" size="sm">
              Check again
            </ButtonLink>
            <ButtonLink href="/support" variant="secondary" size="sm">
              Contact support
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  if (access === 'RESTRICTED') {
    return (
      <div>
        <PageHeader title="Account restricted" />
        <Card className="mt-6">
          <p className="text-sm leading-relaxed text-ink-700">
            This account is not currently active. Only a human support agent can tell you why, and
            nobody outside Averra can lift it. If you believe this is a mistake, contact support
            through the Support Center.
          </p>
          <div className="mt-4">
            <ButtonLink href="/support" size="sm">
              Contact support
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const wallet = await getWalletSummary(user.id);

  const earned = wallet.earnedRewards;

  return (
    <div>
      <PageHeader
        title={profile?.display_name ? `Hello, ${profile.display_name}` : 'Welcome to Averra'}
        description="Your two balances, kept separate by design, plus a direct route back to earning."
      />

      <section className="mt-6">
        <SectionHeading
          title="Earned Reward Balance"
          description="What Averra owes you from verified earning activity. Withdrawable subject to eligibility."
        />

        {earned.length === 0 ? (
          <div className="mt-3">
            <Card tone="sunken" className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-ink-500">
                No earned rewards yet. Complete a task, offer or survey to start earning.
              </p>
              <ButtonLink href="/tasks" size="sm">
                Browse tasks
              </ButtonLink>
            </Card>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {earned.map((balance) => (
              <li key={balance.unit}>
                <BalanceCard
                  title="Earned"
                  description="Verified earning. Available to withdraw."
                  state={balance.reservedMinor > 0n ? 'reserved' : 'settled'}
                  amount={formatMinor(balance.availableMinor)}
                  unit={balance.unit}
                  footer={
                    <dl className="space-y-1 text-xs text-ink-500">
                      <div className="flex justify-between gap-2">
                        <dt>Total</dt>
                        <dd className="font-medium tabular-nums text-ink-700">
                          {formatMinor(balance.balanceMinor)}
                        </dd>
                      </div>
                      {balance.reservedMinor > 0n ? (
                        <div className="flex justify-between gap-2">
                          <dt>Reserved in flight</dt>
                          <dd className="font-medium tabular-nums text-ink-700">
                            {formatMinor(balance.reservedMinor)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading
          title="User Funding Balance"
          description="What you have deposited. It funds platform purchases. It is not withdrawable and it is not earned reward."
        />

        {wallet.userFunding.length === 0 ? (
          <div className="mt-3">
            <Card tone="sunken">
              <p className="text-sm leading-relaxed text-ink-500">
                No funding balance. Deposits are optional and are never required to earn.
              </p>
            </Card>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {wallet.userFunding.map((balance) => (
              <li key={balance.unit}>
                <BalanceCard
                  title="Funding"
                  description="Your deposit. Funds platform purchases only."
                  state="settled"
                  amount={formatMinor(balance.availableMinor)}
                  unit={balance.unit}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <Card tone="brand">
          <h2 className="text-base font-bold tracking-tight">Ready to earn?</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-white/85">
            Complete a task, an offer or a survey. A reward is credited only after the completion is
            verified.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink
              href="/tasks"
              size="sm"
              className="bg-white text-brand-700 hover:bg-white/90"
            >
              Browse tasks
            </ButtonLink>
            <ButtonLink
              href="/earn"
              size="sm"
              className="border border-white/40 text-white hover:bg-white/10"
            >
              Offers and surveys
            </ButtonLink>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink-900">Get help</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            Support is 100% human-operated. Telegram{' '}
            <span className="font-medium text-ink-700">@vipaverra</span> is an official contact
            channel, but an in-app ticket is the authoritative record.
          </p>
          <div className="mt-4">
            <ButtonLink href="/support" variant="secondary" size="sm">
              Open the Support Center
            </ButtonLink>
          </div>
        </Card>
      </section>
    </div>
  );
}
