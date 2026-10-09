import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ThemeScript } from '@/components/theme/ThemeScript';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

// NEXT_PUBLIC_SITE_URL is read here directly rather than through getPublicEnv(), and the
// difference matters.
//
// `export const metadata` is evaluated when this module loads, which `next build` does in
// a page-data collection worker whose environment is not the runtime environment. Calling
// the validated getter would make a missing variable fail the BUILD, not the request - the
// exact failure AGENTS.md records from env validation at import time.
//
// So the rule is: FUNCTIONAL values go through getPublicEnv() and fail loudly at first use
// (the referral link, which is broken without one); COSMETIC values degrade to a known
// default. A wrong canonical URL is a minor defect. A failed production build is not.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://averra.name.ng';

export const metadata: Metadata = {
  title: 'Averra',
  description: 'Averra earning and rewards platform',
  // Without this, Next.js resolves relative OG/canonical URLs against localhost and
  // social previews render with a dead link.
  metadataBase: new URL(siteUrl),
  openGraph: {
    url: siteUrl,
    siteName: 'Averra',
    type: 'website',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `suppressHydrationWarning` and not an accident: the bootstrap script sets
    // `data-theme` on this element before React exists, so the server HTML and
    // the client's first render of <html> disagree about it by design. Without
    // this React logs a hydration mismatch on EVERY page load. The attribute is
    // applied by the script and reconciled by ThemeProvider, never by a render.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Must be in <head> and must run before the body renders. Moving it into
          the body produces a flash of the wrong theme on every navigation, which
          is precisely the defect it exists to prevent.
        */}
        <ThemeScript />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
