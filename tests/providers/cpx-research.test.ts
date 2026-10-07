import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createCpxAdapter, CPX_POSTBACK_IPS } from '@/lib/providers/adapters/cpx-research';
import { cpxReversalEventId } from '@/lib/providers/adapters/cpx-contract';
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

function callback(body: Record<string, unknown>, remoteAddress: string | null = null): RawCallback {
  return {
    providerCode: 'cpx_research',
    body,
    rawBody: '',
    headers: {},
    receivedAt: new Date('2026-01-01T00:00:00Z'),
    // The address the POSTBACK arrived from. Distinct from `ip_click`, which is the end
    // user's address - see the whitelist tests below.
    remoteAddress,
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
// THE POSTBACK IPs ARE EVIDENCE, NOT A GATE - AND THEY BELONG TO THE REQUEST, NOT THE
// END USER.
//
// The previous version of this suite passed a whitelisted address in `ip_click` and
// asserted `knownPostbackIp === true`. That asserted the DEFECT: `ip_click` is the
// address of the person who clicked through to the survey, so a whitelist entry placed
// there is a category error. It also meant the test could never detect the real problem
// below, where a genuine vendor address is absent from CPX's published list.
describe('cpx postback source addresses', () => {
  it('records the three addresses CPX publishes', () => {
    expect(CPX_POSTBACK_IPS).toContain('188.40.3.73');
    expect(CPX_POSTBACK_IPS).toContain('157.90.97.92');
    expect(CPX_POSTBACK_IPS).toContain('2a01:4f8:d0a:30ff:2');
  });

  it('compares the whitelist against the REQUEST address, not the click address', async () => {
    process.env.CPX_SECURE_HASH = SECRET;
    const adapter = createCpxAdapter();

    // Postback arriving from a published address.
    const known = await adapter.handleCallback!(
      callback(
        {
          trans_id: TRANS_ID,
          status: '1',
          type: 'complete',
          amount_local: '1073.48',
          amount_usd: '0.81',
          ip_click: '203.0.113.7',
          hash: vendorHash(TRANS_ID, SECRET),
        },
        '157.90.97.92',
      ),
    );

    expect(known?.normalizedPayload.postbackFromKnownSource).toBe(true);
    expect(known?.normalizedPayload.postbackSourceIp).toBe('157.90.97.92');
    expect(known?.grossValueMinor).toBe(107348n);

    // The click address is recorded as the separate fact it is.
    expect(known?.normalizedPayload.clickIp).toBe('203.0.113.7');
  });

  // A whitelisted value sitting in `ip_click` must NOT mark the source as known. This
  // is the assertion that fails if the two fields are ever conflated again.
  it('does not treat a whitelisted CLICK address as a known postback source', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().handleCallback!(
      callback(
        {
          trans_id: TRANS_ID,
          status: '1',
          type: 'complete',
          amount_local: '1073.48',
          // A publisher address, in the field that means "the end user".
          ip_click: '188.40.3.73',
          hash: vendorHash(TRANS_ID, SECRET),
        },
        // The request itself came from somewhere unlisted.
        '198.51.100.9',
      ),
    );

    expect(result?.normalizedPayload.postbackFromKnownSource).toBe(false);
    expect(result?.normalizedPayload.clickIp).toBe('188.40.3.73');
  });

  // MEASURED, NOT HYPOTHETICAL. A real CPX postback on 2026-10-04 arrived from
  // 44.204.183.114, which CPX does not publish. If this list were a gate, that
  // conversion - and every real one behind it - would be dropped with no error the
  // provider could act on.
  it('does NOT gate on an address CPX never published', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const live = await createCpxAdapter().handleCallback!(
      callback(
        {
          trans_id: TRANS_ID,
          status: '1',
          type: 'complete',
          amount_local: '662.65',
          ip_click: '105.127.16.184',
          hash: vendorHash(TRANS_ID, SECRET),
        },
        '44.204.183.114',
      ),
    );

    expect(CPX_POSTBACK_IPS).not.toContain('44.204.183.114');
    // Flagged false, and STILL NORMALIZES.
    expect(live?.normalizedPayload.postbackFromKnownSource).toBe(false);
    expect(live?.grossValueMinor).toBe(66265n);
  });

  it('reports no source rather than throwing when the request address is unknown', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const result = await createCpxAdapter().handleCallback!(
      callback({
        trans_id: TRANS_ID,
        status: '1',
        type: 'complete',
        amount_local: '1073.48',
        hash: vendorHash(TRANS_ID, SECRET),
      }),
    );

    expect(result?.normalizedPayload.postbackSourceIp).toBeNull();
    expect(result?.normalizedPayload.postbackFromKnownSource).toBe(false);
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

// THE REAL POSTBACK, REPLAYED.
//
// This is the payload captured verbatim in `app.provider_callbacks` id 5 on
// 2026-10-04T21:37:50.934Z, from CPX's own "Click here to test Postback" tool. It is
// kept as a fixture rather than a synthetic example because BOTH defects above were
// invisible to invented payloads:
//
//   * `amount_local` arrived as `662.6500`, four decimal places, which the old
//     fixed-scale check rejected - so this callback produced NORMALIZATION_FAILED while
//     CPX reported the postback delivered and credited the revenue.
//   * `ip_click` was the publisher's own workstation address, not a postback source.
//
// The signature below is the hash CPX actually sent. `LIVE_SECRET` is supplied by the
// runner from CPX_SECURE_HASH; without it the hash cannot be replayed, so those
// assertions are skipped rather than faked with a recomputed value.
const LIVE_TRANS_ID = '1001228131380';
const LIVE_HASH = '7750f4e74fa3020a3a629af57856d75e';

const LIVE_PAYLOAD = {
  hash: LIVE_HASH,
  type: 'complete',
  status: '1',
  subid_1: '',
  subid_2: '',
  user_id: 'averra-test-0001',
  ip_click: '105.127.16.184',
  offer_id: '1',
  trans_id: LIVE_TRANS_ID,
  amount_usd: '0.50',
  amount_local: '662.6500',
} as const;

describe('the live CPX postback of 2026-10-04', () => {
  it('normalizes, which it did NOT before the trailing-zero fix', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const event = await createCpxAdapter().handleCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));

    // The defect returned null here, and null becomes NORMALIZATION_FAILED downstream.
    expect(event).not.toBeNull();
    expect(event?.providerEventId).toBe(LIVE_TRANS_ID);
    expect(event?.status).toBe('VALIDATED');
  });

  it('converts 662.6500 to 66265 kobo, not 6626500', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const event = await createCpxAdapter().handleCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));

    // 662.6500 NGN at a 2-decimal scale. Reading the four digits literally would give a
    // hundredfold overstatement.
    expect(event?.grossValueMinor).toBe(66265n);
    expect(event?.currency).toBe('NGN-kobo');
    expect(event?.normalizedPayload.amountUsdMinor).toBe('50');
  });

  // The publisher's own address is evidence about a person, not a source check.
  it('separates the click address from the postback source address', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const event = await createCpxAdapter().handleCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));

    expect(event?.normalizedPayload.clickIp).toBe('105.127.16.184');
    expect(event?.normalizedPayload.postbackSourceIp).toBe('157.90.97.92');
    expect(event?.normalizedPayload.postbackFromKnownSource).toBe(true);
  });

  // `subid_1` arrived EMPTY, so nothing can resolve a paying user yet. This is the
  // expected state until script-tag issuance and server-side binding exist, and it is
  // why the callback must land as evidence with UNRESOLVED_TRACKING_ID rather than pay.
  it('carries no tracking id, so no user can be resolved from it', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const event = await createCpxAdapter().handleCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));

    expect(event?.trackingId).toBeNull();
    expect(event?.userId).toBe('averra-test-0001');
  });

  it('classifies the fraud reversal CPX sends 15-60 days later', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const reversal = await createCpxAdapter().handleCallback!(
      callback(
        { ...LIVE_PAYLOAD, status: '-2', hash: vendorHash(LIVE_TRANS_ID, SECRET) },
        '157.90.97.92',
      ),
    );

    // Before the -2 fix this returned null and the reversal vanished with no
    // conversion row at all.
    expect(reversal).not.toBeNull();
    expect(reversal?.status).toBe('REVERSED');
    expect(reversal?.normalizedPayload.kind).toBe('REVERSAL');
  });

  // THE CORE ASSERTION: a reversal does not collapse onto its own completion.
  //
  // This is the defect. Recorded under the bare trans_id, law 5's unique index returned
  // the ORIGINAL conversion as a DUPLICATE and the fraud clawback was discarded - no
  // reversal row, no reverse_conversion call, no error anywhere, while CPX's dashboard
  // showed the reversal delivered.
  it('gives a reversal its OWN event identity, so it cannot collide with its completion', async () => {
    process.env.CPX_SECURE_HASH = SECRET;
    const adapter = createCpxAdapter();

    const completion = await adapter.handleCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));
    const reversal = await adapter.handleCallback!(
      callback(
        { ...LIVE_PAYLOAD, status: '-2', hash: vendorHash(LIVE_TRANS_ID, SECRET) },
        '157.90.97.92',
      ),
    );

    // Same vendor transaction, different event identity.
    expect(completion?.providerEventId).toBe(LIVE_TRANS_ID);
    expect(reversal?.providerEventId).not.toBe(LIVE_TRANS_ID);
    expect(reversal?.providerEventId).toBe(`${LIVE_TRANS_ID}:-2`);
  });

  // The link is what lets SQL find the original. It must carry the BARE vendor id, not
  // the suffixed one, or the lookup would search for a transaction id that never existed
  // as a completion.
  it('names the BARE transaction id as the thing being reversed', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const reversal = await createCpxAdapter().handleCallback!(
      callback(
        { ...LIVE_PAYLOAD, status: '-2', hash: vendorHash(LIVE_TRANS_ID, SECRET) },
        '157.90.97.92',
      ),
    );

    expect(reversal?.reversesTransactionId).toBe(LIVE_TRANS_ID);
  });

  // An ordinary completion must NOT claim to reverse anything. If it did, every
  // completion would arrive with a link and the reversal command would be invocable on
  // ordinary rows.
  it('claims no reversal on an ordinary completion', async () => {
    process.env.CPX_SECURE_HASH = SECRET;

    const completion = await createCpxAdapter().handleCallback!(
      callback(LIVE_PAYLOAD, '157.90.97.92'),
    );

    expect(completion?.reversesTransactionId).toBeNull();
  });

  // Both vendor reversal statuses are distinct identities, so neither collapses onto the
  // other or onto the completion. `2` and `-2` are different values in CPX's vocabulary
  // and a numeric comparison would conflate them.
  it('keeps status 2 and status -2 as distinct reversal identities', async () => {
    process.env.CPX_SECURE_HASH = SECRET;
    const adapter = createCpxAdapter();

    const cancelled = await adapter.handleCallback!(
      callback(
        { ...LIVE_PAYLOAD, status: '2', hash: vendorHash(LIVE_TRANS_ID, SECRET) },
        '157.90.97.92',
      ),
    );
    const reversed = await adapter.handleCallback!(
      callback(
        { ...LIVE_PAYLOAD, status: '-2', hash: vendorHash(LIVE_TRANS_ID, SECRET) },
        '157.90.97.92',
      ),
    );

    expect(cancelled?.providerEventId).toBe(`${LIVE_TRANS_ID}:2`);
    expect(reversed?.providerEventId).toBe(`${LIVE_TRANS_ID}:-2`);
    expect(cancelled?.providerEventId).not.toBe(reversed?.providerEventId);
    // Both are reversals, so both are withdrawable.
    expect(cancelled?.status).toBe('REVERSED');
    expect(reversed?.status).toBe('REVERSED');
  });

  // Determinism is what keeps a REPLAYED reversal idempotent: the same status twice must
  // produce the same id, so the unique index can collapse it.
  it('produces a deterministic id, so a replayed reversal still collapses', async () => {
    expect(cpxReversalEventId('1001228169113', '-2')).toBe('1001228169113:-2');
    expect(cpxReversalEventId('1001228169113', '-2')).toBe(
      cpxReversalEventId('1001228169113', '-2'),
    );
    expect(cpxReversalEventId('abc', '2')).not.toBe(cpxReversalEventId('abc', '-2'));
  });

  // ===========================================================================
  // createTrackingLink - the documented CPX entry URL
  //
  // CPX's IFRAME TAG documentation (https://cpx-research.com/main/en/doc.php):
  //
  //   https://offers.cpx-research.com/index.php?app_id={app_id}
  //     &ext_user_id={unique_user_id}&secure_hash={secure_hash}
  //     &username={user_name}&email={user_email}&subid_1=&subid_2=
  //
  // with "e.g. for php md5({unique_user_id}-{app_secure_hash})" for the hash.
  //
  // THESE TESTS ARE REWRITTEN, NOT EXTENDED. The previous versions asserted that the
  // link carried `subid_1` and nothing else - which was true, and was the defect.
  // `app_id` was absent, so CPX could not tell which app a click belonged to and no
  // click was attributable to Averra at all. Those assertions would have passed against
  // a link that cannot work, which is worse than having no test.
  //
  // The outbound hash is REBUILT INDEPENDENTLY here, from the vendor's formula, rather
  // than by calling `cpxEntrySecureHash`. Reusing the implementation would make the
  // suite prove the code agrees with itself.
  // ===========================================================================

  describe('createTrackingLink', () => {
    const APP_ID = '16548';
    const EXT_USER_ID = '9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a';

    beforeEach(() => {
      process.env.CPX_APP_ID = APP_ID;
      process.env.CPX_SECURE_HASH = SECRET;
    });

    afterEach(() => {
      delete process.env.CPX_APP_ID;
    });

    function input(overrides: Record<string, unknown> = {}) {
      return {
        externalId: '123',
        trackingId: 'av_0123456789abcdef0123456789abcdef',
        userId: EXT_USER_ID,
        baseUrl: 'https://offers.cpx-research.invalid/index.php',
        ...overrides,
      };
    }

    // THE MISSING PARAMETER. Everything else about the old link was fine; this one
    // field was what made it unusable.
    it('carries app_id, which CPX requires on every documented entry method', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      expect(new URL(link.url).searchParams.get('app_id')).toBe(APP_ID);
    });

    // Mandatory, unique per user, and documented as the field used for
    // postback/s2s/webhook communication.
    it('carries ext_user_id, the documented postback attribution field', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      expect(new URL(link.url).searchParams.get('ext_user_id')).toBe(EXT_USER_ID);
    });

    // The per-click identity OUR ingest resolves the paying user from. Distinct from
    // ext_user_id, which must stay stable across sessions for CPX's respondent profile.
    it('carries the tracking id in subid_1, which the postback echoes back', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      expect(new URL(link.url).searchParams.get('subid_1')).toBe(
        'av_0123456789abcdef0123456789abcdef',
      );
      expect(link.trackingId).toBe('av_0123456789abcdef0123456789abcdef');
    });

    // The documented outbound hash: md5(ext_user_id + '-' + secret). Rebuilt from the
    // vendor's formula, not from the implementation.
    it('signs the entry link with md5(ext_user_id + "-" + secret)', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      const expected = createHash('md5').update(`${EXT_USER_ID}-${SECRET}`, 'utf8').digest('hex');

      expect(new URL(link.url).searchParams.get('secure_hash')).toBe(expected);
    });

    // THE OUTBOUND AND INBOUND HASHES ARE DIFFERENT. Same secret, different input.
    // Conflating them produces a link CPX rejects or a postback we reject, and the
    // failure is silent because nothing throws - it just never attributes.
    it('does NOT reuse the inbound postback hash formula', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      const inboundShaped = createHash('md5')
        .update(`some-trans-id-${SECRET}`, 'utf8')
        .digest('hex');

      expect(new URL(link.url).searchParams.get('secure_hash')).not.toBe(inboundShaped);
    });

    // THE FAIL-CLOSED PATH. A link with no app_id would send a real user to CPX and
    // produce a conversion attributable to nobody - the exact silent failure this
    // integration has already hit twice. An operator-visible error beats that.
    it('refuses to build a link when CPX_APP_ID is not configured', async () => {
      delete process.env.CPX_APP_ID;

      await expect(createCpxAdapter().createTrackingLink!(input())).rejects.toThrow(/CPX_APP_ID/);
    });

    // A blank value is not a value. `'   '` would otherwise produce `app_id=%20%20%20`,
    // which is a well-formed link to an app that does not exist.
    it('refuses to build a link when CPX_APP_ID is blank', async () => {
      process.env.CPX_APP_ID = '   ';

      await expect(createCpxAdapter().createTrackingLink!(input())).rejects.toThrow(/CPX_APP_ID/);
    });

    // ext_user_id is MANDATORY. Without it the click cannot be tied to an account, so
    // it is a conversion nobody could ever claim.
    it('refuses to build a link with no verified user id', async () => {
      await expect(
        createCpxAdapter().createTrackingLink!(input({ userId: undefined })),
      ).rejects.toThrow(/verified user id/);
    });

    // No configured destination means no link. Falling back to something would send a
    // user onward with no attribution - the exact state this work exists to end.
    it('refuses to build a link with no configured base URL', async () => {
      await expect(
        createCpxAdapter().createTrackingLink!(input({ baseUrl: undefined })),
      ).rejects.toThrow(/no tracking base URL/);
    });

    // A base URL that already carries a query string must survive. String
    // concatenation onto `...?pub_id=7` produces a broken second `?`, which is exactly
    // the kind of defect that shows up only in production traffic.
    it('preserves a query already present on the base URL', async () => {
      const link = await createCpxAdapter().createTrackingLink!(
        input({ baseUrl: 'https://offers.cpx-research.invalid/index.php?pub_id=7&aff=9' }),
      );

      const url = new URL(link.url);
      expect(url.searchParams.get('pub_id')).toBe('7');
      expect(url.searchParams.get('aff')).toBe('9');
      expect(url.searchParams.get('subid_1')).toBe('av_0123456789abcdef0123456789abcdef');
      // Exactly one query string, not two concatenated ones.
      expect(link.url.split('?').length).toBe(2);
    });

    // The tracking id is minted server-side and is hex. Percent-encoding it keeps a
    // future format change from silently corrupting the URL.
    it('URL-encodes the tracking id rather than pasting it in', async () => {
      const link = await createCpxAdapter().createTrackingLink!(
        input({ trackingId: 'av_has spaces&symbols=1' }),
      );

      expect(link.url).not.toContain('spaces&symbols=1');
      expect(new URL(link.url).searchParams.get('subid_1')).toBe('av_has spaces&symbols=1');
    });

    // A destination the client could influence would let a caller send users anywhere
    // while the participation recorded a real offer. The URL comes from our own
    // `offers.tracking_base_url`, so this asserts the input shape has no other channel.
    it('takes the destination only from the supplied base URL', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      expect(new URL(link.url).host).toBe('offers.cpx-research.invalid');
    });

    // Two different users must not receive the same link. If ext_user_id were dropped
    // or overwritten, every user would look identical to CPX and their respondent
    // profiles would merge - which is exactly what CPX's own wording warns against.
    it('gives two users different ext_user_id and different subid_1', async () => {
      const a = await createCpxAdapter().createTrackingLink!(input());
      const b = await createCpxAdapter().createTrackingLink!(
        input({
          userId: '11111111-2222-4333-8444-555555555555',
          trackingId: 'av_ffffffffffffffffffffffffffffffff',
        }),
      );

      const ua = new URL(a.url).searchParams;
      const ub = new URL(b.url).searchParams;

      expect(ua.get('ext_user_id')).not.toBe(ub.get('ext_user_id'));
      expect(ua.get('subid_1')).not.toBe(ub.get('subid_1'));
      // The app is shared; the users are not.
      expect(ua.get('app_id')).toBe(ub.get('app_id'));
    });

    // The SECRET MUST NEVER REACH THE BROWSER. This is the assertion that would fail if
    // someone "fixed" the missing hash by moving configuration into a NEXT_PUBLIC_
    // variable or a client component. npm run check:bundle is the second line of
    // defence; this is the first, and it fails at unit-test speed.
    it('never places the shared secret in the URL, only its md5', async () => {
      const link = await createCpxAdapter().createTrackingLink!(input());

      expect(link.url).not.toContain(SECRET);
    });
  });

  it('verifies the real signature when the live secret is available', async () => {
    const liveSecret = process.env.CPX_LIVE_SECRET;
    if (!liveSecret) return;

    process.env.CPX_SECURE_HASH = liveSecret;

    const result = await createCpxAdapter().verifyCallback!(callback(LIVE_PAYLOAD, '157.90.97.92'));

    expect(result.result).toBe('VERIFIED');
    expect(result.algorithm).toBe('md5(trans_id-secure_hash)');
  });
});
