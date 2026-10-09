import { requireUser } from '@/lib/auth/session';
import { getActiveTokens, getActiveDestination } from '@/lib/deposits/config';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill } from '@/components/ui/Card';
import { DepositForm } from '@/components/wallet/DepositForm';

export const metadata = { title: 'Deposit - Averra' };

// Manual MiniPay crypto deposit (doc 09 MANUAL MINIPAY CRYPTO DEPOSIT, doc 84).
//
// The token allowlist and the destination address come from the SERVER
// (src/lib/deposits/config.ts is the only source of truth, per ADR-0004). The
// page never hardcodes a symbol or an address, so an unverified token can never
// be presented as supported.

export default async function DepositPage() {
  await requireUser();

  const [tokens, destination] = await Promise.all([getActiveTokens(), getActiveDestination()]);

  return (
    <div>
      <PageHeader
        title="Deposit"
        description="Add funds to your User Funding Balance. Deposits are optional and are never required to earn or to withdraw."
      />

      {/* Doc 09 MANDATORY WARNING. Rendered unconditionally and prominently, not
          hidden behind an acknowledgement: sending on the wrong network or with
          the wrong token loses the funds outright. */}
      <Card className="mt-6 border-danger-200 bg-danger-50">
        <p className="text-sm font-semibold text-danger-900">
          Unsupported tokens or the wrong network will lead to loss of funds.
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-danger-800">
          Double-check the network is <strong>Celo</strong> and that the token is one of those
          listed below before sending. Native CELO is not accepted. Averra cannot recover funds sent
          to the wrong network or in an unsupported token.
        </p>
      </Card>

      {tokens.length === 0 || !destination ? (
        <div className="mt-6">
          <EmptyState
            title="Deposits are not available yet"
            description="Averra has not yet activated a deposit destination or verified a supported token contract address. Deposits open once those are RPC-verified. You do not need to deposit to earn."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <Card tone="sunken">
            <h2 className="text-sm font-semibold text-ink-900">Send to this address</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Network:{' '}
              <span className="font-medium text-ink-700">Celo (chain {destination.chainId})</span>
            </p>
            <p className="mt-2 break-all rounded-tile border border-ink-200 bg-surface px-3 py-2 font-mono text-xs text-ink-900">
              {destination.address}
            </p>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-900">Supported tokens</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {tokens.map((t) => (
                <Pill key={t.symbol} tone="brand">
                  {t.symbol}
                </Pill>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Only these tokens, on Celo only. Any other token sent to this address cannot be
              detected or recovered.
            </p>
          </Card>

          <DepositForm tokens={tokens} />
        </div>
      )}
    </div>
  );
}
