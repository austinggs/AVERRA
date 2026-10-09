import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { PillTabs, pillTabId, pillTabPanelId } from '@/components/ui/PillTabs';
import { OfferActions } from '@/components/providers/OfferActions';

export const metadata = { title: 'Earn - Averra' };

// Offers and surveys (doc 13 offerwall, doc 14 surveys).
//
// WHY THIS PAGE USED TO SHOW SO LITTLE
//
// No provider was live. Doc 08 and doc 07 kept all fourteen candidate providers in
// CANDIDATE until signature documentation, sandbox testing, economics, commercial
// approval and compliance review were complete. So there was deliberately no offer to
// show, and this page said so plainly rather than seeding placeholder offers that would
// imply earning was available.
//
// CPX RESEARCH IS LIVE FROM MIGRATION 065. Its wall appears here once its offer row is
// active, which the wrapper still filters on server-side - so this page cannot surface
// a CANDIDATE provider's inventory even if it were modified.
//
// The payout figures are DISPLAY ONLY, and CPX's are deliberately NULL: the wall pays a
// different amount to every matched respondent, so there is no single number to show.
// Doc 13 PRESENTATION forbids overstating certainty, and a payout shown here is never a
// credit: doc 12 verification and the Reward Engine decide that, server-side.

type TabKey = 'offers' | 'surveys';

// Each tab carries its own destination. It was previously a bare `<button>` with no
// handler, which meant the two tabs - which are two URL variants of one page - could
// not reach each other: `activeTab` came from `searchParams.tab`, and nothing on the
// client could change that URL. See src/components/ui/PillTabs.tsx.
const TABS = [
  { key: 'offers', label: 'Offers', href: '/earn?tab=offers' },
  { key: 'surveys', label: 'Surveys', href: '/earn?tab=surveys' },
] as const satisfies ReadonlyArray<{ key: TabKey; label: string; href: string }>;

/**
 * Namespace for the tab/panel id pair.
 *
 * One constant, passed to `PillTabs` as `idPrefix` and to `pillTabId` /
 * `pillTabPanelId` below, because the tabs and the panel are rendered by different
 * elements in this file and an `aria-controls` that points at a renamed id is a
 * silently broken relationship - it renders perfectly and announces nothing.
 */
const PANEL_PREFIX = 'earn';

/**
 * One row for display.
 *
 * Offers and surveys do NOT share column names. `offers` has `category`,
 * `displayed_payout_*` and a tracking link; `surveys` has a `categories` array,
 * `base_reward_minor` and no outbound tracking link. They are normalised here
 * rather than by selecting a shared projection that does not exist.
 */
type EarnItem = {
  id: string;
  title: string;
  description: string | null;
  payout: string | null;
  payoutUnit: string | null;
  tag: string | null;
};

export default async function EarnPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser();

  const params = await searchParams;
  const activeTab: TabKey = params.tab === 'surveys' ? 'surveys' : 'offers';

  const admin = createAdminClient();

  // Routed through public.list_live_offers / public.list_live_surveys, NOT
  // .from('offers'). The app schema is not exposed through the Data API.
  //
  // The wrappers already join app.providers and filter on lifecycle_state =
  // 'LIVE' in the database, so a CANDIDATE provider's inventory cannot surface
  // even if this page were modified.
  const rpc = activeTab === 'offers' ? 'list_live_offers' : 'list_live_surveys';

  const { data, error: earnError } = await admin.rpc(rpc);

  if (earnError) {
    console.error('[earn] inventory read failed', errorFields(earnError, { rpc }));
  }

  const items: EarnItem[] = (data ?? []) as EarnItem[];

  return (
    <div>
      <PageHeader
        title="Earn"
        description="Offers and surveys from approved partners. A displayed payout is an estimate, not a credit: a reward is only ever credited after the completion is verified."
      />

      <div className="mt-6">
        <PillTabs
          items={TABS}
          activeKey={activeTab}
          ariaLabel="Choose between offers and surveys"
          idPrefix={PANEL_PREFIX}
        />
      </div>

      {/*
        THE PANEL, AND WHY IT IS WIRED BOTH WAYS.

        `aria-controls` on the tab names this element, and `aria-labelledby` names
        the tab back. One direction is enough for a screen reader to follow, but
        the reverse link is what makes the panel announce WHICH tab it belongs to,
        and both ids come from the same exported helpers as the tabs so the two
        files cannot drift apart.

        No `tabIndex={0}` here. APG asks for it only when the panel contains no
        focusable elements, and this one always does - the empty state renders a
        link and every row renders a "Start survey" button. Adding it anyway would
        put a blank stop in the tab order immediately after the tablist, which is
        the classic "why does Tab land on nothing" bug.
      */}
      <div
        role="tabpanel"
        id={pillTabPanelId(PANEL_PREFIX, activeTab)}
        aria-labelledby={pillTabId(PANEL_PREFIX, activeTab)}
      >
        {items.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={
                activeTab === 'offers' ? 'No offers available yet' : 'No surveys available yet'
              }
              description="Averra has not yet enabled any live partner inventory. Offers and surveys appear here once a provider completes commercial approval and compliance review. Native tasks are available now."
              action={
                <ButtonLink href="/tasks" size="sm">
                  Browse native tasks
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                {/* `interactive`: this card contains the "Start survey" button
                  below, so a hover lift is a truthful signal that the row is
                  actionable rather than decoration that lies about where the tap
                  target actually is. */}
                <Card interactive>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight text-ink-900">
                        {item.title}
                      </h2>
                      {item.description ? (
                        <p className="mt-1 text-sm leading-relaxed text-ink-500">
                          {item.description}
                        </p>
                      ) : null}
                    </div>

                    {item.payout ? (
                      <p className="shrink-0 text-right">
                        <span className="block text-lg font-bold tabular-nums tracking-tight text-ink-900">
                          {item.payout}
                        </span>
                        <span className="text-xs text-ink-500">{item.payoutUnit}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone="warning">Estimate, not a credit</Pill>
                    {item.tag ? <Pill>{item.tag}</Pill> : null}
                  </div>

                  {/*
                  A BUTTON, NOT AN ANCHOR. The listing wrapper no longer returns an href:
                  a raw `tracking_base_url` carries no app_id, ext_user_id or subid_1,
                  so following it directly sent the user to CPX with nothing
                  identifying and the conversion could not be attributed to anyone.
                  Opening an offer goes through the click route, which mints the
                  tracking identity server-side from the verified session.
                */}
                  <div className="mt-4">
                    <OfferActions offerId={item.id} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
