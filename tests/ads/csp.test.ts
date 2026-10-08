import { describe, expect, it } from 'vitest';
import {
  adContainerId,
  adDeliveryOrigins,
  buildAdAtOptions,
  buildContentSecurityPolicy,
  cspHeaderName,
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  isAdSubsystemConfigured,
  isAdZoneKey,
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

// THE TWO VENDOR SHAPES, PINNED AGAINST THE REAL SUPPLIED ZONES
//
// The dashboard issues a native snippet (loader + a `container-<key>` div) and a
// fixed-size snippet (an `atOptions` assignment + a loader). An earlier `AdSlot` emitted
// only the loader for both, which renders nothing and fails silently in both cases.
//
// The keys below are the ones the operator actually supplied, transcribed from the
// dashboard. No provider HOST is hardcoded here - doc 78 forbids inventing one, and
// `adDeliveryOrigins` derives it from whatever the operator pastes.

describe('native container id is the whole contract with the loader', () => {
  it('derives exactly the id the supplied native loader resolves', () => {
    const NATIVE_KEY = 'dbd459ec1b6b2584886eb554a0940c3f';

    // Supplied snippet:
    //   <script src="https://<host>/21/<key>"></script>
    //   <div id="container-<key>"></div>
    // A one-character difference means the loader finds no mount point and the ad
    // renders nothing, with no error anywhere.
    expect(adContainerId(NATIVE_KEY)).toBe('container-dbd459ec1b6b2584886eb554a0940c3f');
  });

  it('produces an id with no whitespace, so it cannot mismatch on spacing', () => {
    const id = adContainerId('abc123');
    expect(id).toBe('container-abc123');
    expect(id).not.toMatch(/\s/);
  });
});

describe('atOptions carries every field the fixed loader needs', () => {
  it('matches the shape in the supplied 320x50 snippet', () => {
    // Supplied snippet, verbatim:
    //   atOptions = { 'key': '31f84aba...', 'format': 'iframe',
    //                 'height': 50, 'width': 320, 'params': {} }
    const options = buildAdAtOptions('31f84aba23205a9bb7b576cd3eae8121', {
      width: 320,
      height: 50,
    });

    expect(options).toEqual({
      key: '31f84aba23205a9bb7b576cd3eae8121',
      format: 'iframe',
      width: 320,
      height: 50,
      params: {},
    });
  });

  it('omits no required field, because each one alone blanks the ad', () => {
    // Enumerate the required keys rather than spot-checking one: a loader given
    // `format` but no `width` renders nothing, and so does the reverse.
    const options = buildAdAtOptions('k', { width: 300, height: 250 });
    const required = ['key', 'format', 'width', 'height', 'params'];

    const missing = required.filter(
      (field) => options[field as keyof typeof options] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('serialises to a script-safe literal', () => {
    // This string is injected as an inline script, so the zone key is the only
    // env-influenced part of it - and `isAdZoneKey` is what bounds that.
    const serialised = JSON.stringify(buildAdAtOptions('abc-123_X', { width: 300, height: 250 }));

    expect(serialised).toBe(
      '{"key":"abc-123_X","format":"iframe","width":300,"height":250,"params":{}}',
    );
  });
});

describe('the CSP default env is the REAL env, not an empty one', () => {
  // THE DEFECT THIS PINS.
  //
  // `buildContentSecurityPolicy` defaulted to `env = {}`, and `next.config.ts` calls it
  // with no `env`. The shipped policy was therefore derived from an EMPTY environment:
  // no ad origin reached `script-src`, while the client bundle inlined the real zone
  // URLs. Report-only CSP cannot enforce, so nothing broke visibly - the ad just never
  // rendered. Flipping to enforcement would have blocked every ad in production.
  //
  // Every pre-existing test passed an EXPLICIT `env`, so no test ever exercised the
  // default. That is why every gate was green while the header was wrong. This test
  // exercises it directly.

  it('reads the environment by default instead of substituting an empty one', () => {
    // The defect was `options.env ?? {}`. The correct assertion is that the default
    // DELEGATES to `readPublicAdEnv()`, and it has to be written that way: vitest does
    // not load `.env.local`, so in this process `readPublicAdEnv()` returns an empty
    // object and the two policies are legitimately equal. Comparing the policies would
    // therefore pass on the OLD code whenever the ambient env is empty, and fail for
    // the wrong reason whenever it is not - which is why this sets the env itself.
    //
    // Set the real variables, ask for the policy with no `env`, and require the operator
    // host to appear. On the old `?? {}` default this cannot pass.
    const previous = { ...process.env };
    try {
      process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_KEY = 'zone-1';
      process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT = FAKE_SCRIPT;

      const policy = buildContentSecurityPolicy({ reportOnly: true });
      expect(policy).toContain('https://loader.example-adsterra.invalid');
    } finally {
      for (const key of ['NEXT_PUBLIC_ADSTERRA_NATIVE_KEY', 'NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT']) {
        const original = previous[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });

  it('includes the operator ad origin in script-src when configured', () => {
    const policy = buildContentSecurityPolicy({ reportOnly: true, env: configured() });
    const scriptSrc = policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src'));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain('https://loader.example-adsterra.invalid');
  });

  it('still derives an empty policy when nothing is configured', () => {
    // The fix must not invent origins: an unconfigured deployment still gets none.
    // Reported WITH its population so "no origin" is distinguishable from "never ran".
    const policy = buildContentSecurityPolicy({ reportOnly: true, env: {} });

    expect(`${4} formats, ${adDeliveryOrigins({}).length} origins`).toBe('4 formats, 0 origins');
    expect(policy).not.toContain('example-adsterra.invalid');
  });
});

describe('zone key validation fails closed', () => {
  it('accepts the shape of every supplied key', () => {
    // 4 supplied zones. If the vendor rotates to a different opaque token, this is
    // the test that reports it rather than a silently blank slot.
    const supplied = [
      'dbd459ec1b6b2584886eb554a0940c3f',
      '438355b6149b70d223c3a50c3d4c5847',
      '31f84aba23205a9bb7b576cd3eae8121',
      '0c9e2935d866cf372db5b6367412064e',
    ];

    expect(supplied.filter((key) => !isAdZoneKey(key))).toEqual([]);
  });

  it('rejects a key that could break out of the inline script or the element id', () => {
    // These reach `JSON.stringify` inside an inline <script> and an element id.
    // A rejected key renders no ad, which is the correct outcome.
    const hostile = ['a"><script>alert(1)</script>', 'a b', "a';alert(1)//", '<b>', 'a'.repeat(200)];

    expect(hostile.filter((key) => isAdZoneKey(key))).toEqual([]);
  });

  it('refuses a zone whose key is unusable, rather than rendering an unmatched ad', () => {
    // Present but malformed must fail CLOSED. Without this the key would be
    // interpolated into an id the loader can never match - an empty box, silently.
    expect(
      readAdZone('native', {
        NEXT_PUBLIC_ADSTERRA_NATIVE_KEY: 'a"><script>alert(1)</script>',
        NEXT_PUBLIC_ADSTERRA_NATIVE_SCRIPT: FAKE_SCRIPT,
      }),
    ).toBeNull();
  });
});