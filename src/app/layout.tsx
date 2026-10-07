import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
