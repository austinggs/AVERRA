import { describe, expect, it } from 'vitest';
import {
  adDeliveryOrigins,
  buildContentSecurityPolicy,
  cspHeaderName,
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  isAdSubsystemConfigured,
  readAdZone,
} from '@/lib/ads/delivery';

// A stand-in for the loader URL the operator pastes from the Adsterra dashboard.
// Deliberately NOT a real host: doc 78 forbids inventing a provider host, and a test
// that asserted a guessed host would launder a guess into a passing assertion.
const FAKE_SCRIPT = 'https://loader.example-adsterra.invalid/ad.js';

const configured = (script = FAKE_SCRIPT) => ({
  NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: 'zone-1',
  NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: script,
});

describe('ad configuration fails closed', () => {
  it('reports the subsystem as unconfigured when nothing is set', () => {
    // This is the CURRENT production state: no ad renders at all, and that is the
    // intended default until an operator pastes real values.
    expect(isAdSubsystemConfigured({})).toBe(false);
    expect(readAdZone('native', {})).toBeNull();
  });

  it('requires BOTH the key and the script', () => {
    // A half-configured zone must render nothing rather than a broken frame.
    expect(readAdZone('native', { NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: 'zone-1' })).toBeNull();
    expect(readAdZone('native', { NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: FAKE_SCRIPT })).toBeNull();
  });

  it('rejects a loader URL that is not http(s)', () => {
    // A `javascript:` src would be an XSS sink if it ever reached the DOM.
    expect(
      readAdZone('native', {
        NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: 'zone-1',
        NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: 'javascript:alert(1)',
      }),
    ).toBeNull();
  });

  it('reports itself configured only when a real zone exists', () => {
    expect(isAdSubsystemConfigured(configured())).toBe(true);
  });
});

describe('CSP ad origins are DERIVED from the configured loader', () => {
  it('derives the origin from the operator script rather than a stored list', () => {
    const origins = adDeliveryOrigins(configured());

    expect(origins).toEqual(['https://loader.example-adsterra.invalid']);
  });

  it('derives NOTHING when no zone is configured', () => {
    // 4 formats, 0 origins. Reported WITH its population, so "no origins" is
    // distinguishable from "the derivation never ran".
    expect(`${4} formats, ${adDeliveryOrigins({}).length} origins`).toBe('4 formats, 0 origins');
  });

  it('de-duplicates and sorts when several zones share one host', () => {
    const env = {
      NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: 'a',
      NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: FAKE_SCRIPT,
      NEXT_PUBLIC_ADSTERRA_300X250_KEY: 'b',
      NEXT_PUBLIC_ADSTERRA_300X250_SCRIPT: FAKE_SCRIPT,
    };

    expect(adDeliveryOrigins(env)).toEqual(['https://loader.example-adsterra.invalid']);
  });

  it('carries a changed loader URL into the policy without a code change', () => {
    // THE POINT OF DERIVING. Swap the operator's host and the policy follows. A
    // hand-maintained CSP host list would have blocked this silently.
    const moved = configured('https://new-host.example-adsterra.invalid/ad.js');
    const policy = buildContentSecurityPolicy({ env: moved });

    expect(policy).toContain('https://new-host.example-adsterra.invalid');
    expect(policy).not.toContain('https://loader.example-adsterra.invalid');
  });
});

describe('content security policy', () => {
  it('ships REPORT-ONLY, and names the header accordingly', () => {
    // The whole point of the report-only phase is that it does not block anything yet.
    expect(CSP_REPORT_ONLY_HEADER).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName(true)).toBe(CSP_REPORT_ONLY_HEADER);
    expect(cspHeaderName(false)).toBe(CSP_ENFORCE_HEADER);
  });

  it('reports violations to a reachable endpoint', () => {
    // The endpoint is only useful if it is PUBLIC; `public-paths.test.ts` asserts
    // that separately, because a private endpoint produces an empty, clean-looking
    // reports stream.
    const policy = buildContentSecurityPolicy({ env: {} });
    expect(policy).toContain('report-uri /api/csp-report');
  });

  it('denies object, base and framing by default', () => {
    const policy = buildContentSecurityPolicy({ env: {} });

    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain('base-uri \'self\'');
    expect(policy).toContain('frame-ancestors ' + "'none'");
  });

  it('allows blob workers, which the Mining Game needs', () => {
    // Three.js doc 17/31 runs a worker; removing this breaks the game, and it is
    // worth asserting so nobody tightens it without finding out in production.
    expect(buildContentSecurityPolicy({ env: {} })).toContain("worker-src 'self' blob:");
  });

  it('derives the Supabase origin and its wss equivalent from configuration', () => {
    const policy = buildContentSecurityPolicy({
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' },
    });

    expect(policy).toContain('https://abc.supabase.co');
    expect(policy).toContain('wss://abc.supabase.co');
  });

  it('produces a stable, de-duplicated directive string', () => {
    // Stable output keeps a header diff between two deployments readable, and no
    // directive may appear twice in one policy.
    const env = configured();
    const first = buildContentSecurityPolicy({ env });
    const second = buildContentSecurityPolicy({ env });

    expect(first).toBe(second);

    const directives = first.split('; ').map((directive) => directive.split(' ')[0]);
    expect(new Set(directives).size).toBe(directives.length);
  });
});