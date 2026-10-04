import { describe, expect, it } from 'vitest';
import { createCpxCaptureAdapter } from '@/lib/providers/adapters/cpx-capture';

// THE SAFETY PROPERTY.
//
// The capture adapter exists only so `app.provider_callbacks` receives the raw CPX
// payload. It must never authenticate anything, because `ingestProviderCallback`
// returns before `handleCallback` on any non-`VERIFIED` result - and that early
// return is precisely what stops a conversion, and therefore a reward, from existing.
//
// If any of these ever passed, this adapter would be a live money path that reports
// itself as not being one.
describe('cpx capture adapter', () => {
  const adapter = createCpxCaptureAdapter();

  const raw = (
    overrides: Partial<Parameters<NonNullable<typeof adapter.verifyCallback>>[0]> = {},
  ) => ({
    providerCode: 'cpx_research',
    body: {},
    rawBody: '',
    headers: {},
    receivedAt: new Date('2026-01-01T00:00:00Z'),
    remoteAddress: null,
    signature: null,
    ...overrides,
  });

  it('refuses to verify an empty callback', async () => {
    const result = await adapter.verifyCallback!(raw());

    expect(result.result).toBe('UNSUPPORTED');
    expect(result.reason).toContain('unverified');
  });

  it('refuses a callback carrying a signature', async () => {
    const result = await adapter.verifyCallback!(
      raw({ body: { hash: 'deadbeef' }, rawBody: 'a=1', signature: 'deadbeef' }),
    );

    expect(result.result).toBe('UNSUPPORTED');
  });

  it('refuses a callback whose body claims to be complete', async () => {
    const result = await adapter.verifyCallback!(
      raw({
        body: { status: '1', amount: '0.81', trans_id: 'abc', currency: 'USD' },
        rawBody: 'status=1&amount=0.81',
      }),
    );

    expect(result.result).not.toBe('VERIFIED');
    expect(result.result).toBe('UNSUPPORTED');
  });

  // Structural safety: the adapter must not even implement handleCallback, because
  // ingest's guard is `!adapter?.verifyCallback || !adapter.handleCallback`. Implementing
  // it would not change the outcome here, but leaving it absent keeps the capture
  // adapter incapable of producing a normalized event by construction.
  it('cannot normalize a callback into a conversion', () => {
    expect(adapter.handleCallback).toBeUndefined();
  });

  it('never reports a verification algorithm', async () => {
    const result = await adapter.verifyCallback!(raw());

    // Claiming an algorithm would suggest a scheme was implemented.
    expect(result.algorithm).toBeUndefined();
  });
});
