import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUserAccounts, getReservedByUnit, type BalanceUnit } from '@/lib/wallet/queries';

// Wallet read model.
//
// THE central separation of the product: Earned Reward Balance and User Funding
// Balance are DIFFERENT domains with different purposes, and this module is
// structured so a caller cannot conflate them by accident (law 56, doc 36).
//
//  - Earned Reward Balance : what Averra OWES the user. May be withdrawn.
//  - User Funding Balance  : what the user PUT IN. Buys platform goods. Never
//                            withdrawable by default.

export type EarnedRewardBalance = {
  domain: 'EARNED_REWARD';
  unit: BalanceUnit;
  /** Amount owed to the user, including anything pending or on hold. */
  balanceMinor: bigint;
  /** Reserved by an in-flight withdrawal. Not spendable, not lost. */
  reservedMinor: bigint;
  /** balance - reserved. Only this may enter a withdrawal request. */
  availableMinor: bigint;
};

export type UserFundingBalance = {
  domain: 'USER_FUNDING';
  unit: BalanceUnit;
  balanceMinor: bigint;
  reservedMinor: bigint;
  availableMinor: bigint;
};

/** One currency's worth of estimated provider earnings. NEVER summed across
 *  units: NGN minor units and USD minor units are not the same quantity, so a
 *  combined figure would be a fabricated number. */
export type ProvisionalCurrencyTotal = {
  unit: BalanceUnit;
  /** Sum of gross_value_minor over the qualifying conversions. */
  totalMinor: bigint;
  /** How many conversions contributed. */
  eventCount: number;
};

/** One recent estimated-earning event, for the display list. */
export type ProvisionalEarningEvent = {
  conversionId: string;
  providerCode: string;
  eventType: string;
  /** Our adapter's classification of the callback. NOT a payability verdict. */
  status: string;
  estimatedMinor: bigint;
  currency: BalanceUnit;
  attributedAt: string;
};

/**
 * Estimated/potential earnings from provider conversions that have not entered
 * the confirmed/available reward path.
 *
 * THIS IS NOT A BALANCE AND NOT MONEY. It is a read-only projection with no
 * ledger entry behind it. Nothing in the withdrawal path reads it, and it is
 * never added into `earnedRewards` or `userFunding`.
 *
 * The word "provisional" is load-bearing: a provider said something, we accepted
 * the callback, and we have NOT confirmed the money. A VALIDATED status means
 * the callback passed our checks -- NOT that the provider confirmed it is
 * payable. CPX's status semantics are still unconfirmed in writing.
 */
export type ProvisionalEarnings = {
  /** One entry per currency. Never a cross-currency total. */
  byCurrency: ProvisionalCurrencyTotal[];
  /** Capped detail list for display. The aggregates above are the authority. */
  recent: ProvisionalEarningEvent[];
};

export type WalletSummary = {
  earnedRewards: EarnedRewardBalance[];
  userFunding: UserFundingBalance[];
  /** Estimated earnings, kept structurally separate from both balances.
   *
   * Critical invariant: there is deliberately no field anywhere in this file
   * that adds these into a spendable or withdrawable figure.
   */
  provisionalEarnings: ProvisionalEarnings;
};

type Serialised<T> = Omit<T, 'balanceMinor' | 'reservedMinor' | 'availableMinor'> & {
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
};

/** BigInt cannot cross a JSON boundary, so every amount becomes a decimal
 *  string rather than being coerced through `Number`, which would silently lose
 *  precision above 2^53. */
export type ProvisionalEarningsJson = {
  byCurrency: Array<{ unit: BalanceUnit; totalMinor: string; eventCount: number }>;
  recent: Array<{
    conversionId: string;
    providerCode: string;
    eventType: string;
    status: string;
    estimatedMinor: string;
    currency: BalanceUnit;
    attributedAt: string;
  }>;
};

export type WalletSummaryJson = {
  earnedRewards: Array<Serialised<EarnedRewardBalance>>;
  userFunding: Array<Serialised<UserFundingBalance>>;
  provisionalEarnings: ProvisionalEarningsJson;
};

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const accounts = await getUserAccounts(userId);

  const reserved = await getReservedByUnit(
    userId,
    accounts.map((a) => a.accountId),
  );

  const earnedRewards: EarnedRewardBalance[] = [];
  const userFunding: UserFundingBalance[] = [];

  for (const account of accounts) {
    if (account.domain !== 'EARNED_REWARD' && account.domain !== 'USER_FUNDING') {
      continue;
    }

    const reservedMinor = reserved.get(account.unit) ?? 0n;

    if (account.domain === 'EARNED_REWARD') {
      earnedRewards.push({
        domain: 'EARNED_REWARD',
        unit: account.unit,
        balanceMinor: account.balanceMinor,
        reservedMinor,
        availableMinor: account.balanceMinor - reservedMinor,
      });
    } else {
      userFunding.push({
        domain: 'USER_FUNDING',
        unit: account.unit,
        balanceMinor: account.balanceMinor,
        reservedMinor,
        availableMinor: account.balanceMinor - reservedMinor,
      });
    }
  }

  return {
    earnedRewards,
    userFunding,
    provisionalEarnings: await getProvisionalEarnings(userId),
  };
}

/** Row shape returned by `public.get_provisional_earnings`. Kept local because the
 *  Supabase admin client is loosely typed: a column that does not exist fails at
 *  RUNTIME, not at typecheck. Declaring it here means one place to check against
 *  migration 064. */
type ProvisionalPayload = {
  byCurrency?: Array<{ unit?: string; totalMinor?: string | number; eventCount?: number }>;
  recent?: Array<{
    conversionId?: string;
    providerCode?: string;
    eventType?: string;
    status?: string;
    estimatedMinor?: string | number;
    currency?: string;
    attributedAt?: string;
  }>;
};

/**
 * PostgREST returns `bigint` as a JSON STRING, not a number, precisely because
 * JavaScript numbers cannot hold the range. The previous version of this file
 * branched on `typeof row.gross_minor === 'number'` and silently produced 0 for
 * every real row, which would have rendered the estimate as zero forever with no
 * error anywhere. Normalise both shapes instead of assuming either.
 */
function toBigInt(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value);
  } catch {
    // A malformed amount is dropped to zero rather than throwing. This is a
    // display-only projection, and it must never be the reason a wallet page
    // fails to render. The authoritative amount, if one exists, is on the
    // conversion row and is unaffected by this.
    return 0n;
  }
}

/**
 * Estimated provider earnings, read-only and outside every financial path.
 *
 * Read failures are swallowed on purpose. A wallet page that cannot reach this
 * ONE optional projection must still show the two real balances; conversely,
 * this function must never fall back to zero-pretending-to-be-money, which is
 * why an error yields an EMPTY projection rather than a fabricated one.
 */
async function getProvisionalEarnings(userId: string): Promise<ProvisionalEarnings> {
  const EMPTY: ProvisionalEarnings = { byCurrency: [], recent: [] };

  let payload: ProvisionalPayload;
  try {
    const { data, error } = await createAdminClient().rpc('get_provisional_earnings', {
      p_user_id: userId,
    });

    if (error) {
      // Logged, not thrown. See the note above.
      console.warn('[wallet] provisional earnings unavailable', {
        code: error.code ?? null,
      });
      return EMPTY;
    }

    payload = (data ?? {}) as ProvisionalPayload;
  } catch (cause) {
    console.warn('[wallet] provisional earnings unavailable', {
      reason: cause instanceof Error ? cause.message : 'unknown',
    });
    return EMPTY;
  }

  const byCurrency = (payload.byCurrency ?? [])
    .map((row) => ({
      unit: row.unit ?? 'UNKNOWN',
      totalMinor: toBigInt(row.totalMinor),
      eventCount: Number(row.eventCount ?? 0),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit));

  const recent = (payload.recent ?? []).map((row) => ({
    conversionId: row.conversionId ?? '',
    providerCode: row.providerCode ?? '',
    eventType: row.eventType ?? '',
    status: row.status ?? '',
    estimatedMinor: toBigInt(row.estimatedMinor),
    currency: row.currency ?? 'UNKNOWN',
    attributedAt: row.attributedAt ?? '',
  }));

  return { byCurrency, recent };
}

/** BigInt cannot cross a JSON boundary, so amounts cross as decimal strings. */
export function serializeWallet(summary: WalletSummary): WalletSummaryJson {
  const shape = <T extends { balanceMinor: bigint; reservedMinor: bigint; availableMinor: bigint }>(
    list: T[],
  ) =>
    list.map((item) => ({
      ...item,
      balanceMinor: item.balanceMinor.toString(10),
      reservedMinor: item.reservedMinor.toString(10),
      availableMinor: item.availableMinor.toString(10),
    }));

  return {
    earnedRewards: shape(summary.earnedRewards),
    userFunding: shape(summary.userFunding),
    // Serialised explicitly rather than passed through `shape`, because this
    // projection has no reserved/available pair -- it must never acquire one.
    provisionalEarnings: {
      byCurrency: summary.provisionalEarnings.byCurrency.map((row) => ({
        unit: row.unit,
        totalMinor: row.totalMinor.toString(10),
        eventCount: row.eventCount,
      })),
      recent: summary.provisionalEarnings.recent.map((row) => ({
        conversionId: row.conversionId,
        providerCode: row.providerCode,
        eventType: row.eventType,
        status: row.status,
        estimatedMinor: row.estimatedMinor.toString(10),
        currency: row.currency,
        attributedAt: row.attributedAt,
      })),
    },
  };
}
