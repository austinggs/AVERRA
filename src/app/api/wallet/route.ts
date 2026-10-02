import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { getWalletSummary, serializeWallet } from '@/lib/wallet/summary';

// GET /api/wallet
//
// Returns BOTH balances as separate collections. The response deliberately has
// no combined "total", because summing a reward liability and a user deposit
// into one number is exactly the conflation the spec forbids (doc 36 FINANCIAL
// DOMAINS, doc 51 FINANCIAL UX).

export const GET = route(async ({ user }) => {
  const summary = await getWalletSummary(user!.id);

  return NextResponse.json(serializeWallet(summary));
});
