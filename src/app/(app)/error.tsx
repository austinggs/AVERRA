'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';

// Error boundary for the sessioned shell.
//
// WHY A FINANCIAL APP NEEDS THIS SPECIFICALLY
//
// Every page in this group reads a balance or a reward. When one of those reads
// fails, the honest outcome is "we could not load this", not an empty page and
// not a zero. An uncaught render error here previously produced Next's default
// boundary, which shows a digest and no way forward - so a user whose wallet
// timed out was left staring at a stack reference.
//
// THE ONE THING THIS MUST NOT DO
//
// It must not render a balance, a placeholder balance, or anything that could
// be read as one. `reset()` re-runs the failed server render; it does not
// invent a value, and no state is seeded here. That is deliberate: an error
// state that showed "0" would be indistinguishable from a genuinely empty
// wallet, which is a financial misrepresentation caused by a rendering fault.
//
// `digest` is logged so the failure is traceable in the server logs, and the
// copy tells the user plainly that no figure is being shown rather than leaving
// them to wonder whether they have money.

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side console only. The server render that failed already logged
    // the real cause; this is for reproducing it from the browser during
    // development.
    console.error('[app] route error', error.message, error.digest ?? '');
  }, [error]);

  return (
    <div className="pt-6" role="alert">
      <div className="rounded-card border border-danger-200 bg-danger-50 p-5 md:p-6">
        <h1 className="text-xl font-bold tracking-tight text-danger-900">
          We could not load this page
        </h1>

        <p className="mt-2 max-w-prose text-sm leading-relaxed text-danger-800">
          Something went wrong while fetching your data. No balance or reward figure is being shown,
          because none could be read - your money is unaffected and no figure has been changed.
        </p>

        {error.digest ? (
          <p className="mt-3 text-xs text-danger-700">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset} size="sm">
            Try again
          </Button>
          <ButtonLink href="/dashboard" variant="secondary" size="sm">
            Go to dashboard
          </ButtonLink>
          <ButtonLink href="/support/new" variant="ghost" size="sm">
            Contact support
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}