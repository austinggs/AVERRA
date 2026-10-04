import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createCpxAdapter, CPX_POSTBACK_IPS } from '@/lib/providers/adapters/cpx-research';
import type { RawCallback } from '@/lib/providers/types';

// CPX documents its postback signature as, verbatim from the publisher panel:
//
//     "hash is a md5 hash: example: md5({trans_id}-yourappsecurehash)"
//
// The tests below REBUILD that hash independently rather than calling the adapter's
// own helper. Reusing the implementation would make the suite prove that the code
// agrees with itself.
const SECRET = 'test-secret-not-the-real-one';
const TRANS_ID = 'abc123';

function vendorHash(transId: string, secret: string): string {
  return createHash('md5').update(`${transId}-${secret}`, 'utf8').digest('hex');
}

function callback(body: Record<string, unknown>): RawCallback {
  return {
    providerCode: 'cpx_research',
    body,
    rawBody: '',
    headers: {},
    receivedAt: new Date('2026-01-01T00:00:00Z'),
    remoteAddress: null,
    signature: null,
  };
}

afterEach(() => {
  delete process.env.CPX_SECURE_HASH;
});

describe('cpx signature verification', () => {
  it('accepts the vendor-documented hash', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: vendorHash(TRANS_ID, SECRET) }),
    );

    expect(result.result).toBe('VERIFIED');
    expect(result.algorithm).toBe('md5(trans_id-secure_hash)');
  });

  // THE FAIL-CLOSED PATH. An unconfigured provider must not accept traffic that looks
  // authentic (law 4), and the read is LAZY so a missing variable cannot fail the
  // Vercel build at module load.
  it('refuses everything when the secret is not configured', async () => {
    delete process.env.CPX_SECURE_HASH;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: vendorHash(TRANS_ID, SECRET) }),
    );

    expect(result.result).toBe('UNSUPPORTED');
    expect(result.reason).toContain('CPX_SECURE_HASH');
  });

  it('rejects a hash computed with a different secret', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: vendorHash(TRANS_ID, 'wrong-secret') }),
    );

    expect(result.result).toBe('FAILED');
  });

  // The separator is the whole point. `md5(trans_id + secret)` is what one third-party
  // integration reported; if we had guessed that, every real callback fails closed.
  it('rejects a hash built WITHOUT the documented hyphen separator', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const noSeparator = createHash('md5').update(`${TRANS_ID}${SECRET}`, 'utf8').digest('hex');

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: noSeparator }),
    );

    expect(result.result).toBe('FAILED');
  });

  // The hash covers the transaction id, so a valid signature replayed against a
  // different trans_id must not verify.
  it('rejects a valid hash replayed against a different transaction', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: 'other-id', hash: vendorHash(TRANS_ID, SECRET) }),
    );

    expect(result.result).toBe('FAILED');
  });

  it('reports ABSENT when the hash is missing entirely', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(callback({ trans_id: TRANS_ID }));

    expect(result.result).toBe('ABSENT');
  });

  it('rejects a callback with no transaction id', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ hash: vendorHash(TRANS_ID, SECRET) }),
    );

    expect(result.result).toBe('FAILED');
  });

  // A wrong-length hash must not throw: timingSafeEqual throws on a length mismatch,
  // and a bad request should not become a 500.
  it('does not throw on a malformed hash of the wrong length', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: 'abc' }),
    );

    expect(result.result).toBe('FAILED');
  });

  it('tolerates an uppercase hash, since hex is case insensitive', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().verifyCallback!(
      callback({ trans_id: TRANS_ID, hash: vendorHash(TRANS_ID, SECRET).toUpperCase() }),
    );

    expect(result.result).toBe('VERIFIED');
  });
});
// THE POSTBACK IPs ARE EVIDENCE, NOT A GATE.
describe('cpx postback whitelist IPs', () => {
  it('records the three addresses CPX publishes', () => {
    expect(CPX_POSTBACK_IPS).toContain('188.40.3.73');
    expect(CPX_POSTBACK_IPS).toContain('157.90.97.92');
    expect(CPX_POSTBACK_IPS).toContain('2a01:4f8:d0a:30ff:2');
  });

  it('flags a listed address, and does NOT gate on an unlisted one', async () => {
    process.env.CPX_SECURE_HASH = SECRET;
    const adapter = createCpxAdapter();

    const known = await adapter.handleCallback!(
      callback({
        trans_id: TRANS_ID,
        status: '1',
        type: 'complete',
        amount_local: '1073.48',
        amount_usd: '0.81',
        ip_click: '188.40.3.73',
        hash: vendorHash(TRANS_ID, SECRET),
      }),
    );

    expect(known?.normalizedPayload.knownPostbackIp).toBe(true);
    expect(known?.grossValueMinor).toBe(107348n);

    // An unlisted IP is flagged false and STILL NORMALIZES. Hard-gating on the list
    // would drop every callback permanently and silently if CPX ever changed an
    // address, which is the exact failure this integration hit twice already.
    const unknown = await adapter.handleCallback!(
      callback({
        trans_id: 'other',
        status: '1',
        type: 'complete',
        amount_local: '1073.48',
        ip_click: '203.0.113.7',
        hash: vendorHash('other', SECRET),
      }),
    );

    expect(unknown?.normalizedPayload.knownPostbackIp).toBe(false);
    expect(unknown?.grossValueMinor).toBe(107348n);
  });
});

// A malformed amount must REFUSE. Defaulting to zero would create a real conversion
// worth nothing and look like a successful completion.
describe('cpx amount handling', () => {
  it('refuses a malformed amount rather than defaulting to zero', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    for (const amount of ['', 'abc', '-5.00', '1e3', '10.1234']) {
      const result = await createCpxAdapter().handleCallback!(
        callback({
          trans_id: TRANS_ID,
          status: '1',
          type: 'complete',
          amount_local: amount,
          hash: vendorHash(TRANS_ID, SECRET),
        }),
      );

      expect(result).toBeNull();
    }
  });

  it('keeps both amounts so the frozen rate can be audited later', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().handleCallback!(
      callback({
        trans_id: TRANS_ID,
        status: '1',
        type: 'complete',
        amount_local: '1073.48',
        amount_usd: '0.81',
        hash: vendorHash(TRANS_ID, SECRET),
      }),
    );

    // 1073.48 NGN at 1325.29/USD is NOT 0.81 USD x 100: CPX rounds the local figure
    // to two decimals, so the two permanently disagree. Recording both keeps that
    // drift visible instead of losing it.
    expect(result?.grossValueMinor).toBe(107348n);
    expect(result?.currency).toBe('NGN-kobo');
    expect(result?.normalizedPayload.amountUsdMinor).toBe('81');
  });

  // CPX publishes no timestamp placeholder. Claiming a provider event time would
  // invent evidence, so arrival time is used and the payload says so.
  it('records that the event time did not come from the provider', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().handleCallback!(
      callback({
        trans_id: TRANS_ID,
        status: '1',
        type: 'complete',
        amount_local: '10.00',
        hash: vendorHash(TRANS_ID, SECRET),
      }),
    );

    expect(result?.normalizedPayload.eventTimeProvidedByProvider).toBe(false);
    expect(result?.eventTimestamp).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('refuses an unrecognised status/type pair outright', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().handleCallback!(
      callback({
        trans_id: TRANS_ID,
        status: '9',
        type: 'brand_new_thing',
        amount_local: '10.00',
        hash: vendorHash(TRANS_ID, SECRET),
      }),
    );

    expect(result).toBeNull();
  });
});
