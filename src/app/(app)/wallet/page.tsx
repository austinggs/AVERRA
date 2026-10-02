import { requireUser } from '@/lib/auth/session';
import { getWalletSummary } from '@/lib/wallet/summary';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';
import { BalanceCard } from '@/components/ui/MoneyState';
import { ButtonLink } from '@/components/ui/Button';

export const metadata = { title: 'Wallet - Averra' };

// Amounts are integer minor units. The minor-unit size is configuration, and the
// spec requires the source asset and quantity be preserved rather than assumed,
// so the raw integer is shown with its unit rather than rescaled speculatively.
function formatMinor(amount: bigint): string {
  return amount.toString(10);
}

export default async function WalletPage() {
  const user = await requireUser();
  const wallet = await getWalletSummary(user.id);

  return (
    <div>
      <PageHeader
        title="Wallet"
        description="Two separate balances. Averra never adds them together, because they are different kinds of money."
      />

      <section className="mt-6">
        <SectionHeading
          title="Earned Reward Balance"
          description="Money Averra owes you from verified earning activity. Eligible amounts can be withdrawn."
        />

        {wallet.earnedRewards.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No earned rewards yet"
              description="Complete a task, offer or survey to start earning. A reward is credited only after the completion is verified."
              action={
                <ButtonLink href="/tasks" variant="primary" size="sm">
                  Browse tasks
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {wallet.earnedRewards.map((balance) => (
              <li key={balance.unit}>
                <BalanceCard
                  title="Earned Reward Balance"
                  description="Verified earning. Withdrawable subject to eligibility."
                  // Reserved money is not spendable, so the card says so rather
                  // than showing one large available figure.
                  state={balance.reservedMinor > 0n ? 'reserved' : 'settled'}
                  amount={formatMinor(balance.availableMinor)}
                  unit={balance.unit}
                  footer={
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
                      <div className="flex gap-1.5">
                        <dt>Total</dt>
                        <dd className="font-medium tabular-nums text-ink-700">
                          {formatMinor(balance.balanceMinor)} {balance.unit}
                        </dd>
                      </div>
                      {balance.reservedMinor > 0n ? (
                        <div className="flex gap-1.5">
                          <dt>Reserved by an in-flight withdrawal</dt>
                          <dd className="font-medium tabular-nums text-ink-700">
                            {formatMinor(balance.reservedMinor)} {balance.unit}
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

        <div className="mt-3">
          <ButtonLink href="/wallet/withdraw" variant="primary" size="sm">
            Request a withdrawal
          </ButtonLink>
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading
          title="User Funding Balance"
          description="Money you deposited. It funds platform purchases. It is not withdrawable and it is not earned reward."
        />

        {wallet.userFunding.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No funding balance"
              description="Deposits are optional and are never required to earn or to withdraw."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {wallet.userFunding.map((balance) => (
              <li key={balance.unit}>
                <BalanceCard
                  title="User Funding Balance"
                  description="Your deposit. Funds platform purchases only."
                  state="settled"
                  amount={formatMinor(balance.availableMinor)}
                  unit={balance.unit}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <ButtonLink href="/wallet/deposit" variant="secondary" size="sm">
            Make a deposit
          </ButtonLink>
        </div>
      </section>

      <Card className="mt-8 border-gamify-400/40 bg-gamify-400/10">
        <div className="flex items-start gap-3">
          <Pill tone="warning">Fee disclosure</Pill>
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Before you withdraw</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
              Eligible withdrawals carry a 15% Platform Service and Maintenance Fee. You always see
              the gross amount, the fee and your net payout before you confirm. The fee is not
              applied to deposits.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
