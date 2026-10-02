'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, Pill } from '@/components/ui/Card';

// Manual MiniPay crypto deposit request (doc 84 USER FLOW steps 1-6).
//
// The client picks an asset from the SERVER-supplied allowlist and declares an
// amount. It cannot supply a contract address, choose a network, or credit
// anything: the server owns all of that (docs 48, 51, 84).
//
// The wording is deliberately careful. "Sent" is not "detected", "detected" is
// not "verified", and none of them is "credited" (doc 09 TRANSPARENCY). A
// deposit credits the User Funding Balance only after an operator confirms it.

interface Token {
  symbol: string;
  chainId: number;
  contractAddress: string;
  decimals: number;
}

interface Created {
  id: string;
  reference: string;
  status: string;
  expiresAt: string;
}

export function DepositForm({ tokens }: { tokens: Token[] }) {
  const [symbol, setSymbol] = useState(tokens[0]?.symbol ?? '');
  const [amount, setAmount] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'created' | 'error'>('idle');
  const [created, setCreated] = useState<Created | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (created) {
    return (
      <Card tone="sunken">
        <Pill>Request created</Pill>
        <h2 className="mt-3 text-base font-semibold text-ink-900">Now send the funds</h2>

        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Reference</dt>
            <dd className="font-mono text-xs text-ink-900">{created.reference}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Token</dt>
            <dd className="text-ink-700">{symbol}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Declared amount</dt>
            <dd className="tabular-nums text-ink-700">{amount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Expires</dt>
            <dd className="text-ink-700">{new Date(created.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>

        <div className="mt-4 rounded-tile border border-gamify-400/40 bg-gamify-400/10 p-3">
          <p className="text-xs font-semibold text-ink-900">This is not credited yet</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-700">
            Sending is not detecting. Once you send, submit your transaction hash so the deposit can
            be detected and verified. Your User Funding Balance is credited only after an operator
            confirms it.
          </p>
        </div>

        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreated(null);
              setPhase('idle');
            }}
          >
            Start another deposit
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPhase('submitting');
          setMessage(null);

          const res = await fetch('/api/deposits', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              symbol,
              // Minor units. The client declares an integer; the server applies
              // the configured token decimals.
              amountMinor: amount,
              senderAddress: senderAddress || undefined,
            }),
          });

          const body = (await res.json()) as {
            deposit?: Created;
            error?: { message: string };
          };

          if (!res.ok || body.error || !body.deposit) {
            setPhase('error');
            setMessage(body.error?.message ?? 'Could not start the deposit request.');
            return;
          }

          setCreated(body.deposit);
          setPhase('created');
        }}
        className="space-y-5"
      >
        <div>
          <label htmlFor="symbol" className="text-xs font-medium text-ink-500">
            Token
          </label>
          <select
            id="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm"
          >
            {tokens.map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="deposit-amount" className="text-xs font-medium text-ink-500">
            Amount (minor units)
          </label>
          <input
            id="deposit-amount"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm tabular-nums"
          />
          <p className="mt-1.5 text-xs text-ink-500">
            Enter the amount in the smallest unit. Check the decimals for {symbol} before sending.
          </p>
        </div>

        <div>
          <label htmlFor="sender" className="text-xs font-medium text-ink-500">
            Your sending address (optional)
          </label>
          <input
            id="sender"
            value={senderAddress}
            onChange={(e) => setSenderAddress(e.target.value)}
            placeholder="0x…"
            className="mt-1.5 min-h-11 w-full rounded-tile border border-ink-200 bg-surface px-3 font-mono text-xs"
          />
        </div>

        {message ? (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={phase === 'submitting'} className="w-full sm:w-auto">
          {phase === 'submitting' ? 'Creating…' : 'Create deposit request'}
        </Button>
      </form>
    </Card>
  );
}
