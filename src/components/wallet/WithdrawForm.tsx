'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, Pill } from '@/components/ui/Card';
import { quoteWithdrawal, FEE_NOTICE, type WithdrawalMethod } from '@/lib/financial/withdrawal';

// Withdrawal request form.
//
// THE FEE IS DISCLOSED BEFORE CONFIRMATION (law 45, doc 83). Gross, fee and net
// are computed here with the SAME pure function the API and the database use,
// and shown live as the user types. The amount displayed is the amount honoured:
// the API recomputes with `quoteWithdrawal` and the database stores that split.
//
// This form never claims a payout is done. It creates a REQUEST, which enters
// the manual operator workflow (law 22) and awaits confirmation.

const METHODS: ReadonlyArray<{ value: WithdrawalMethod; label: string; hint: string }> = [
  {
    value: 'MINIPAY_MANUAL',
    label: 'MiniPay (manual)',
    hint: 'Paid by a named operator after your destination is verified.',
  },
  {
    value: 'BANK_MANUAL',
    label: 'Bank transfer (manual)',
    hint: 'Paid by a named operator after your destination is verified.',
  },
  {
    value: 'CRYPTO_AUTOMATIC_DAIMO',
    label: 'Crypto (automatic)',
    hint: 'Sent automatically once your destination is verified and approved.',
  },
];

interface Props {
  /** Available earned reward balance per unit, as decimal strings. */
  balances: Array<{ unit: string; availableMinor: string }>;
  destinations: Array<{ id: string; method: string; status: string; label: string }>;
}

export function WithdrawForm({ balances, destinations }: Props) {
  const router = useRouter();
  const [unit, setUnit] = useState(balances[0]?.unit ?? '');
  const [method, setMethod] = useState<WithdrawalMethod>('MINIPAY_MANUAL');
  const [destinationId, setDestinationId] = useState('');
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const available = balances.find((b) => b.unit === unit)?.availableMinor ?? '0';

  // Computed with the shared pure function, so this preview and the server's
  // authoritative quote cannot drift apart.
  const quote = useMemo(() => {
    const gross = BigInt(amount || '0');
    return gross > 0n ? quoteWithdrawal(gross) : null;
  }, [amount]);

  // A manual destination must be VERIFIED before use, so an unverified one is
  // offered but visibly marked rather than hidden and confusing.
  const usable = destinations.filter((d) => d.method === method);

  if (phase === 'done') {
    return (
      <Card tone="sunken">
        <Pill tone="brand">Request received</Pill>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{message}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          This is a request, not a payment. An operator reviews it, and you will see the state
          change before any money moves.
        </p>
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={() => router.push('/wallet')}>
            Back to wallet
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPhase('submitting');
        setMessage(null);

        const res = await fetch('/api/withdrawals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, destinationId, grossMinor: amount, unit }),
        });

        const body = (await res.json()) as {
          withdrawal?: { status: string };
          error?: { message: string };
        };

        if (!res.ok || body.error) {
          setPhase('error');
          setMessage(body.error?.message ?? 'Could not create the withdrawal request.');
          return;
        }

        setPhase('done');
        setMessage(`Your withdrawal request is recorded with status ${body.withdrawal?.status}.`);
        router.refresh();
      }}
    >
      <Card>
        {balances.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-500">
            You have no earned reward balance to withdraw. Your User Funding Balance is a deposit
            and cannot be withdrawn.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <label htmlFor="unit" className="text-xs font-medium text-ink-500">
                Balance
              </label>
              <select
                id="unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm"
              >
                {balances.map((b) => (
                  <option key={b.unit} value={b.unit}>
                    {b.unit} — {b.availableMinor} available
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-xs font-medium text-ink-500">Method</span>
              <div className="mt-1.5 space-y-2">
                {METHODS.map((m) => (
                  <label
                    key={m.value}
                    className="flex cursor-pointer items-start gap-3 rounded-tile border border-ink-200 p-3 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="radio"
                      name="method"
                      checked={method === m.value}
                      onChange={() => {
                        setMethod(m.value);
                        setDestinationId('');
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink-900">{m.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-500">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="destination" className="text-xs font-medium text-ink-500">
                Payout destination
              </label>
              <select
                id="destination"
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                required
                className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm"
              >
                <option value="">Select a verified destination…</option>
                {usable.map((d) => (
                  <option key={d.id} value={d.id} disabled={d.status !== 'VERIFIED'}>
                    {d.label} {d.status !== 'VERIFIED' ? `(${d.status.toLowerCase()})` : ''}
                  </option>
                ))}
              </select>
              {usable.length === 0 ? (
                <p className="mt-1.5 text-xs text-ink-500">
                  You have no payout destination for this method yet.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="amount" className="text-xs font-medium text-ink-500">
                Gross amount ({unit})
              </label>
              <input
                id="amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm tabular-nums"
              />
              <p className="mt-1.5 text-xs text-ink-500">
                Available: {available} {unit}. Enter the GROSS amount. The fee is deducted from it,
                not added on top.
              </p>
            </div>

            {quote ? (
              <div className="rounded-tile bg-surface-sunken p-4">
                <p className="text-xs font-semibold text-ink-900">You will receive</p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Gross</dt>
                    <dd className="tabular-nums text-ink-700">{quote.grossMinor.toString()}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Fee (15%)</dt>
                    <dd className="tabular-nums text-ink-700">−{quote.feeMinor.toString()}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-ink-200 pt-1">
                    <dt className="font-semibold text-ink-900">Net payout</dt>
                    <dd className="font-semibold tabular-nums text-ink-900">
                      {quote.netMinor.toString()} {unit}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-ink-500">{FEE_NOTICE}</p>
              </div>
            ) : null}

            {message ? (
              <p role="alert" className="text-sm text-danger-700">
                {message}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={phase === 'submitting' || !destinationId || !quote}
              className="w-full sm:w-auto"
            >
              {phase === 'submitting' ? 'Submitting…' : 'Request withdrawal'}
            </Button>
          </div>
        )}
      </Card>
    </form>
  );
}
