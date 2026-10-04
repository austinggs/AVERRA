'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { formatPrice } from '@/lib/perks/present';
import type { PerkProduct } from '@/lib/perks/reads';

// The two-step purchase flow (law 47).
//
// Step 1 creates a PENDING order - which moves NO money - and returns the price the
// DATABASE priced from the catalogue. Step 2 confirms and pays. The user sees the
// exact figure between the two steps, so what they confirm is what is charged.
//
// The request bodies carry a product CODE and an order ID. Neither carries an amount.
// There is no field here to tamper with, which is the point: `create_paid_perk_order`
// and `purchase_with_funding` each re-derive the price and refuse if they disagree.
//
// The confirmation panel is a second click on purpose. A single tap that both creates
// an order and takes money is a purchase the user never confirmed.

type Stage =
  | { kind: 'idle' }
  | { kind: 'confirming'; orderId: string; priceMinor: number; unit: string; name: string }
  | { kind: 'paying'; orderId: string; priceMinor: number; unit: string; name: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; name: string };

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Something went wrong. Please try again.');
  }

  return (payload ?? {}) as Record<string, unknown>;
}

export function PerkCatalogue({ products }: { products: PerkProduct[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const busy = stage.kind === 'paying';

  async function beginOrder(product: PerkProduct) {
    try {
      const result = await post('/api/perks', { productCode: product.code });
      const order = result.order as { id: string; priceMinor: string; unit: string };

      setStage({
        kind: 'confirming',
        orderId: order.id,
        priceMinor: Number(order.priceMinor),
        unit: order.unit,
        name: product.name,
      });
    } catch (error) {
      setStage({ kind: 'error', message: (error as Error).message });
    }
  }

  async function confirmPurchase() {
    if (stage.kind !== 'confirming') return;

    const { orderId, priceMinor, unit, name } = stage;
    setStage({ kind: 'paying', orderId, priceMinor, unit, name });

    try {
      await post(`/api/perks/orders/${orderId}/purchase`, {});
      setStage({ kind: 'done', name });

      // Re-read from the server rather than patching local state: the order status,
      // the entitlement and the funding spend were all decided by the database.
      router.refresh();
    } catch (error) {
      setStage({ kind: 'error', message: (error as Error).message });
    }
  }

  async function cancelOrder() {
    if (stage.kind !== 'confirming') return;

    try {
      await post(`/api/perks/orders/${stage.orderId}/cancel`, {});
      setStage({ kind: 'idle' });
      router.refresh();
    } catch (error) {
      setStage({ kind: 'error', message: (error as Error).message });
    }
  }

  return (
    <div>
      {stage.kind === 'confirming' || stage.kind === 'paying' ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-tile border border-brand-200 bg-brand-50 p-4"
        >
          <p className="text-sm font-semibold text-ink-900">
            {busy ? 'Processing payment…' : `Confirm ${stage.name}`}
          </p>

          <p className="mt-1 text-sm text-ink-700">
            You will be charged{' '}
            <strong className="tabular-nums">{formatPrice(stage.priceMinor, stage.unit)}</strong>{' '}
            from your User Funding Balance (your deposited money).
          </p>

          <p className="mt-2 text-xs leading-relaxed text-ink-600">
            Your Earned Reward Balance cannot be used to pay for a perk. Those are two separate
            kinds of money and Averra does not convert between them.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void confirmPurchase()}
            >
              {busy ? 'Paying…' : 'Pay now'}
            </Button>

            {/* Cancelling is NOT a refund: nothing has been paid yet. */}
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void cancelOrder()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {stage.kind === 'done' ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-tile border border-brand-200 bg-brand-50 p-4"
        >
          <p className="text-sm font-semibold text-ink-900">{stage.name} is now active.</p>
          <p className="mt-1 text-sm text-ink-700">
            The payment came from your User Funding Balance and appears in your spending history
            below.
          </p>
        </div>
      ) : null}

      {stage.kind === 'error' && stage.message ? (
        <div role="alert" className="mb-4 rounded-tile border border-danger-200 bg-danger-50 p-4">
          <p className="text-sm font-semibold text-ink-900">That did not work</p>
          <p className="mt-1 text-sm text-ink-700">{stage.message}</p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {products.map((product) => (
          <li key={product.id}>
            <div className="rounded-tile border border-ink-100 bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{product.name}</p>
                  {product.description ? (
                    <p className="mt-1 text-sm text-ink-600">{product.description}</p>
                  ) : null}
                </div>

                <p className="shrink-0 text-sm font-bold tabular-nums text-ink-900">
                  {formatPrice(product.priceMinor, product.unit)}
                </p>
              </div>

              {product.owned ? (
                <p className="mt-3 text-sm font-medium text-brand-700">
                  You own this. It is active on your account.
                </p>
              ) : (
                <div className="mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void beginOrder(product)}
                  >
                    Buy
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
