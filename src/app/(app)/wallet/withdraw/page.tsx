import { requireUser } from '@/lib/auth/session';
import { getWalletSummary } from '@/lib/wallet/summary';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/PageHeader';
import { WithdrawForm } from '@/components/wallet/WithdrawForm';

export const metadata = { title: 'Withdraw - Averra' };

export default async function WithdrawPage() {
  const user = await requireUser();
  const wallet = await getWalletSummary(user.id);
  const admin = createAdminClient();

  // Routed through `public.list_my_payout_destinations`, NOT
  // `.from('payout_destinations')`. The `app` schema is not exposed through the
  // Data API.
  const { data: destinations } = await admin.rpc('list_my_payout_destinations', {
    p_user_id: user.id,
  });

  // BigInt cannot cross to a client component, so amounts cross as strings and
  // are re-parsed by the form. The server remains the authority on the split.
  const balances = wallet.earnedRewards.map((b) => ({
    unit: b.unit,
    availableMinor: b.availableMinor.toString(10),
  }));

  const mapped = (destinations ?? []).map(
    (d: {
      id: string;
      method: string;
      status: string;
      accountIdentifier: string;
      accountHolder: string | null;
    }) => {
      const row = d;

      return {
        id: row.id,
        method: row.method,
        status: row.status,
        // The account identifier is the user's own payout detail, shown back to
        // them for confirmation. It is never logged or sent anywhere else.
        label: `${row.accountHolder ? `${row.accountHolder} · ` : ''}${row.accountIdentifier}`,
      };
    },
  );

  return (
    <div>
      <PageHeader
        title="Withdraw"
        description="Request a payout from your Earned Reward Balance. A 15% Platform Service and Maintenance Fee is deducted from the gross amount, and you always see the exact net payout before you confirm."
      />

      <div className="mt-6">
        <WithdrawForm balances={balances} destinations={mapped} />
      </div>
    </div>
  );
}
