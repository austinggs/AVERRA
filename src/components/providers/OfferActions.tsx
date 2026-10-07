'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

// Opens a provider offer.
//
// WHY THIS IS A BUTTON AND NOT A LINK
//
// The listing wrapper `public.list_live_offers` used to return `href`, which was the
// RAW `offers.tracking_base_url`. Migration 065 removes that field, because a raw base
// URL cannot carry the values CPX requires on every documented entry method:
//
//     app_id        which app the click belongs to
//     ext_user_id   the user, and the field CPX uses for postback/s2s/webhook
//     secure_hash   md5(ext_user_id + '-' + shared secret)
//     subid_1       our per-click tracking id, which is how the paying user is resolved
//
// None of those can be computed for an anonymous page render: `app_id` and the secret
// are server-only, and `ext_user_id`/`subid_1` exist only for a signed-in user. An href
// would therefore have sent the user to CPX with nothing identifying, and every
// conversion would have arrived unattributable.
//
// So the click goes through `POST /api/providers/offers/[id]/click`, which mints the
// participation server-side from the VERIFIED SESSION and returns the finished URL.
// The user id is never read from the request body.
//
// THIS COMPONENT CANNOT PAY ANYTHING AND DOES NOT CLAIM TO. Opening a link pays
// nothing: a reward requires a signature-verified callback, and it only becomes
// spendable after the provider's settlement report is reconciled exactly.
interface StartResponse {
  url?: string;
  message?: string;
  error?: { code: string; message: string };
}

export function OfferActions({ offerId }: { offerId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setMessage(null);

    let body: StartResponse;

    try {
      const res = await fetch(`/api/providers/offers/${offerId}/click`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No user id, no tracking id, no amount. All of it is server-derived.
        body: JSON.stringify({}),
      });

      body = (await res.json()) as StartResponse;
    } catch {
      setBusy(false);
      setMessage('Could not open that offer. Please try again.');
      return;
    }

    if (!body.url) {
      setBusy(false);
      setMessage(body.error?.message ?? 'That offer is not available right now.');
      return;
    }

    // `noopener` so the CPX page cannot reach back through `window.opener`.
    window.open(body.url, '_blank', 'noopener,noreferrer');
    setBusy(false);
    setMessage(body.message ?? 'Opening your survey…');
  }

  return (
    <div>
      <Button onClick={open} disabled={busy} className="w-full sm:w-auto">
        {busy ? 'Opening…' : 'Start survey'}
      </Button>

      {message ? (
        <p role="status" className="mt-3 text-xs leading-relaxed text-ink-500">
          {message}
        </p>
      ) : null}
    </div>
  );
}