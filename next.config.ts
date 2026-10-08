import type { NextConfig } from 'next';
import { buildContentSecurityPolicy, cspHeaderName } from './src/lib/ads/delivery';

// CSP ships REPORT-ONLY in CR-0039.
//
// The header name comes from `cspHeaderName(true)` rather than being typed out, so
// flipping to enforcement is a one-word change in one place and the header name
// cannot disagree with the policy builder about which mode we are in.
//
// Enforcement is deliberately NOT this change. The report-only phase exists to show
// us which directives are load-bearing before they start blocking; the reasoning and
// the ordered rollout are in the CR-0039 change record.
const contentSecurityPolicy = buildContentSecurityPolicy({ reportOnly: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: cspHeaderName(true),
            value: contentSecurityPolicy,
          },
          // An ad script legitimately wants to know which page it is on, but a full
          // query string carries our tracking ids, so cross-origin gets origin only.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
