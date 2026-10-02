import 'server-only';
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

export type WalletSummary = {
  earnedRewards: EarnedRewardBalance[];
  userFunding: UserFundingBalance[];
};

type Serialised<T> = Omit<T, 'balanceMinor' | 'reservedMinor' | 'availableMinor'> & {
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
};

export type WalletSummaryJson = {
  earnedRewards: Array<Serialised<EarnedRewardBalance>>;
  userFunding: Array<Serialised<UserFundingBalance>>;
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

  return { earnedRewards, userFunding };
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
  };
}
