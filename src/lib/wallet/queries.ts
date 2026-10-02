import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { describeError } from '@/lib/observability/errors';

// Ledger read helpers.
//
// Balances are derived from ledger_entries. account_balances is a cache that
// app_private.rebuild_account_balances() can reproduce exactly (law 13,
// doc 36 BALANCE DERIVATION). A read never trusts a client-supplied amount.
//
// ROUTING: this module calls `public.get_wallet_summary`, NOT `admin.from(...)`.
//
// The `app` schema is deliberately NOT exposed through the Supabase Data API, so
// a PostgREST `.select()` cannot reach `app.ledger_accounts` or
// `app.account_balances`. Reads of app tables go through named `public`
// SECURITY DEFINER wrappers (migration 030). Using `.from()` here fails at
// runtime with a table-not-found error even when every migration is applied.

export type BalanceUnit = string;

export type AccountBalance = {
  accountId: string;
  domain: string;
  unit: BalanceUnit;
  balanceMinor: bigint;
};

type SummaryRow = {
  unit: string;
  balanceMinor: string | number;
  reservedMinor: string | number;
  availableMinor: string | number;
};

/**
 * Reads both balances for one user.
 *
 * The two domains are returned separately and are NEVER combined here. Merging
 * them is the specific error doc 09 and law 56 exist to prevent, so there is no
 * total anywhere in this function.
 */
export async function getUserAccounts(userId: string): Promise<AccountBalance[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('get_wallet_summary', {
    p_user_id: userId,
  });

  if (error) {
    // Fail closed. Showing a spendable balance we cannot verify is worse than
    // showing nothing.
    throw new Error(`wallet: unable to read accounts (${describeError(error)})`);
  }

  const summary = (data ?? {}) as {
    earnedRewards?: SummaryRow[];
    userFunding?: SummaryRow[];
  };

  const toAccount = (row: SummaryRow, domain: string): AccountBalance => ({
    // The wrapper is an aggregate and does not return account ids, so the id is
    // not available here. Nothing downstream needs it: callers only ever needed
    // the balance and the unit.
    accountId: '',
    domain,
    unit: row.unit,
    balanceMinor: BigInt(row.balanceMinor ?? 0),
  });

  return [
    ...(summary.earnedRewards ?? []).map((r) => toAccount(r, 'EARNED_REWARD')),
    ...(summary.userFunding ?? []).map((r) => toAccount(r, 'USER_FUNDING')),
  ];
}

/**
 * Reserved amounts, per unit, derived by the database from live withdrawal
 * reservations that have neither settled nor been released.
 *
 * Derived from the ledger rather than read from a counter, so it cannot drift
 * from the entries that created it (doc 36).
 */
export async function getReservedByUnit(
  userId: string,
  _accountIds: string[],
): Promise<Map<BalanceUnit, bigint>> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('get_wallet_summary', {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`wallet: unable to read reservations (${describeError(error)})`);
  }

  const summary = (data ?? {}) as {
    earnedRewards?: SummaryRow[];
    userFunding?: SummaryRow[];
  };

  const reserved = new Map<BalanceUnit, bigint>();

  for (const row of [...(summary.earnedRewards ?? []), ...(summary.userFunding ?? [])]) {
    const amount = BigInt(row.reservedMinor ?? 0);
    if (amount > 0n) {
      reserved.set(row.unit, amount);
    }
  }

  return reserved;
}
