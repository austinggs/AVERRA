import { requireUser } from '@/lib/auth/session';
import {
  listMyEntitlements,
  listMyFundingSpends,
  listMyPerkOrders,
  listPerkProducts,
} from '@/lib/perks/reads';
import {
  describeOrderStatus,
  describeSpendPurpose,
  entitlementTone,
  formatPrice,
  spendTone,
} from '@/lib/perks/present';
import { PerkCatalogue } from '@/components/perks/PerkCatalogue';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';
import { MoneyState } from '@/components/ui/MoneyState';

export const metadata = { title: 'Perks - Averra' };

// The paid-perk surface (doc 83).
//
// LAW 47 SEPARATION IS THE ORGANISING IDEA. A perk is bought with USER FUNDING BALANCE
// - deposited money - and never with Earned Reward Balance. The two are different
// kinds of money (law 56) and this page never suggests otherwise.
//
// NO PRODUCT IS SEEDED. `app.paid_perk_products` is empty and deliberately so: a perk
// is a real commercial decision with a real price, and inventing one here would put a
// figure in front of users that nobody approved. The empty state says so plainly
// rather than showing a placeholder product.
//
// A PENDING ORDER IS NOT A PURCHASE. Creating one moves no money, and the order list
// says "Awaiting payment" in a warning tone - never a brand green, which this
// codebase reserves exclusively for credited money.
//
// ALL FOUR READS COME FROM `public` WRAPPERS. The `app` schema is not exposed through
// the Data API, so a direct `.from('paid_perk_products')` would fail with PGRST205.

export default async function PerksPage() {
  const user = await requireUser();

  const [products, orders, entitlements, spends] = await Promise.all([
    listPerkProducts(user.id),
    listMyPerkOrders(user.id),
    listMyEntitlements(user.id),
    listMyFundingSpends(user.id),
  ]);

  return (
    <div>
      <PageHeader
        title="Perks"
        description="Paid extras, bought with your deposited balance. Earned rewards are a different kind of money and cannot pay for these."
      />

      <section className="mt-6">
        <SectionHeading
          title="Catalogue"
          description="Prices come from the catalogue. The amount you see is the amount charged."
        />

        {products.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No perks are available right now"
              description="Nothing has been published to the catalogue yet. We would rather show you an empty list than invent a price for something that has not been decided."
            />
          </div>
        ) : (
          <div className="mt-3">
            <PerkCatalogue products={products} />
          </div>
        )}
      </section>

      {entitlements.length > 0 ? (
        <section className="mt-8">
          <SectionHeading
            title="Your perks"
            description="Purchased capabilities on your account. These are entitlements, not balances."
          />

          <ul className="mt-3 space-y-3">
            {entitlements.map((entitlement) => (
              <li key={entitlement.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {entitlement.productName}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        {entitlement.endsAt
                          ? `Access until ${new Date(entitlement.endsAt).toLocaleDateString()}`
                          : 'No expiry recorded'}
                      </p>
                    </div>

                    {/* An entitlement is a capability, not money, so it gets its own
                        tone rather than a reward-state mapping. */}
                    <Pill tone={entitlementTone(entitlement.status)}>
                      {entitlement.status.toLowerCase()}
                    </Pill>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionHeading
          title="Order history"
          description="A pending order is an intention to pay. Nothing has been charged until it reads paid."
        />

        {orders.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No orders yet"
              description="When you buy a perk it appears here with its exact price and status."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {orders.map((order) => {
              const status = describeOrderStatus(order.status);

              return (
                <li key={order.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink-900">{order.productName}</p>
                        <p className="mt-1 text-sm tabular-nums text-ink-700">
                          {formatPrice(order.priceMinor, order.unit)}
                        </p>
                        <p className="mt-1 text-xs text-ink-500">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-ink-600">{status.copy}</p>
                      </div>

                      <Pill tone={status.tone}>{order.status.toLowerCase()}</Pill>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {spends.length > 0 ? (
        <section className="mt-8">
          <SectionHeading
            title="Spending history"
            description="Every debit from, and credit to, your User Funding Balance for perks and donations."
          />

          <ul className="mt-3 space-y-3">
            {spends.map((spend) => (
              <li key={spend.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-ink-700">{describeSpendPurpose(spend.purpose)}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {new Date(spend.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    {/* A refund is a CREDIT. `is_refund` decides the direction, so a
                        refunded purchase is not shown as a second debit. */}
                    <div className="text-right">
                      <MoneyState
                        state={spendTone(spend.isRefund)}
                        amount={formatPrice(spend.amountMinor, spend.unit)}
                      />
                      <p className="mt-1 text-xs text-ink-500">
                        {spend.isRefund ? 'returned to you' : 'from your funding balance'}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card tone="sunken" className="mt-8">
        <p className="text-xs leading-relaxed text-ink-500">
          Perks are paid for with your User Funding Balance, which is your deposited money. They are
          not rewards, they are not withdrawable, and they never count toward a referral qualifying
          value. If a perk is not working for you, contact support — a refund is handled by a
          person, not automatically.
        </p>
      </Card>
    </div>
  );
}
