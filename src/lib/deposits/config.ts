import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// Server-provided deposit configuration.
//
// Docs 48, 51 and 84 are unambiguous: a token or an address is supported ONLY
// when the server returns it from active configuration. This module is therefore
// the ONLY place the client learns what is supported.
//
// The filtering that makes that safe happens in the DATABASE, in
// `public.list_supported_tokens` and `public.get_active_destination`, not in this
// file. That is a deliberate reversal of the previous arrangement, where the
// `.eq('is_active', true)` and the address checks lived here in TypeScript. A
// safety property that depends on a filter in application code is one edit away
// from not being a safety property.

// Celo mainnet. Every supported token and every receiving destination is on this
// chain. There is a single constant rather than a literal repeated per call so
// the two reads cannot drift apart and start describing different networks.
const CELO_MAINNET = 42220;

// The only deposit method that is actually implemented. MiniPay Cash Link and
// Daimo are seeded but unavailable, and must not be offered.
const DEPOSIT_METHOD = 'MANUAL_MINIPAY_CRYPTO';

export type ActiveToken = {
  symbol: string;
  chainId: number;
  contractAddress: string;
  decimals: number;
};

export type ActiveDestination = {
  address: string;
  chainId: number;
  network: 'celo';
  method: string;
};

/**
 * The production allowlist. Returns an empty list when nothing is verified,
 * which is the correct pre-launch state rather than a failure.
 */
export async function getActiveTokens(): Promise<ActiveToken[]> {
  const admin = createAdminClient();

  // Routed through `public.list_supported_tokens`, NOT
  // `.from('deposit_token_configs')`. The `app` schema is not exposed through the
  // Data API.
  //
  // The wrapper returns only rows that are ACTIVE, RPC-verified and actually
  // carry a contract address and decimals. That is what makes this file safe to
  // treat as the allowlist: the exclusion of unverified tokens happens in the
  // database, not in a filter here that a future edit could drop.
  const { data, error } = await admin.rpc('list_supported_tokens', { p_chain_id: CELO_MAINNET });

  if (error) {
    throw new Error(`deposits: unable to read the token allowlist (${error.message})`);
  }

  // Defence in depth: re-assert the invariants the table constraint enforces.
  // A row that somehow lacks an address must never reach a user as supported.
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Defence in depth: re-assert the invariants the table constraint enforces.
  // A row that somehow lacks an address must never reach a user as supported.
  return rows
    .filter(
      (row) =>
        typeof row.contractAddress === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(row.contractAddress) &&
        typeof row.decimals === 'number',
    )
    .map((row) => ({
      symbol: row.symbol as string,
      chainId: row.chainId as number,
      contractAddress: row.contractAddress as string,
      decimals: row.decimals as number,
    }));
}

export async function getActiveDestination(): Promise<ActiveDestination | null> {
  const admin = createAdminClient();

  // Routed through `public.get_active_destination`, NOT
  // `.from('platform_destinations')`. The `app` schema is not exposed through the
  // Data API.
  //
  // The wrapper returns only an ACTIVE, verified destination. "No destination" is
  // NULL rather than an empty object, because that is the signal to refuse a
  // deposit rather than to send funds somewhere unverified.
  const { data, error } = await admin.rpc('get_active_destination', {
    p_chain_id: CELO_MAINNET,
    p_method: DEPOSIT_METHOD,
  });

  if (error) {
    throw new Error(`deposits: unable to read the deposit destination (${error.message})`);
  }

  const row = (data ?? null) as Record<string, unknown> | null;

  if (!row || typeof row.address !== 'string') return null;

  return {
    address: row.address,
    chainId: row.chainId as number,
    network: 'celo',
    method: row.method as string,
  };
}
