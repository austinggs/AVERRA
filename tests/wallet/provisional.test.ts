import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws when imported outside a React Server Component, and this
// module is server-side by design. Mocking it is the established pattern in
// tests/providers/*.test.ts, not a workaround specific to this file.
vi.mock('server-only', () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

import {
  getWalletSummary,
  serializeWallet,
  type ProvisionalEarnings,
  type WalletSummary,
} from '@/lib/wallet/summary';

// These assertions cover the READ MODEL for provisional provider earnings.
//
// THE INVARIANT UNDER TEST
//
// Estimated earnings are not money. They must never acquire a spendable or
// withdrawable shape, never be folded into Earned Reward Balance or User Funding
// Balance, and never be summed across currencies.
//
// A test that only checks the happy path would pass against the previous
// version of this code, which returned `unit: 'minor'` -- a single cross-unit
// total, exactly the figure doc 09 forbids. The negative assertions below are
// the ones that would have caught it.

/** Indexing helpers.
 *
 *  `noUncheckedIndexedAccess` is on, so `list[0]` is `T | undefined`. These
 *  narrow it once, in one place, with a message that says what went wrong -
 *  rather than sprinkling `!` through the assertions, where a `!` would silence
 *  a genuinely missing element instead of surfacing it. `expect(x).toBeDefined()`
 *  first would not narrow the type, so the check is an explicit throw.
 */
function first<T>(list: readonly T[], what: string): T {
  const value = list[0];
  if (value === undefined) throw new Error(`expected ${what} to hold at least one row`);
  return value;
}

function earnings(overrides: Partial<ProvisionalEarnings> = {}): ProvisionalEarnings {
  return {
    byCurrency: [
      { unit: 'NGN', totalMinor: 500_000n, eventCount: 2 },
      { unit: 'USD', totalMinor: 1_500n, eventCount: 1 },
    ],
    recent: [
      {
        conversionId: 'c-1',
        providerCode: 'cpx_research',
        eventType: 'SURVEY',
        status: 'VALIDATED',
        estimatedMinor: 250_000n,
        currency: 'NGN',
        attributedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function summary(overrides: Partial<WalletSummary> = {}): WalletSummary {
  return {
    earnedRewards: [
      {
        domain: 'EARNED_REWARD',
        unit: 'NGN',
        balanceMinor: 1_000n,
        reservedMinor: 400n,
        availableMinor: 600n,
      },
    ],
    userFunding: [
      {
        domain: 'USER_FUNDING',
        unit: 'NGN',
        balanceMinor: 2_000n,
        reservedMinor: 0n,
        availableMinor: 2_000n,
      },
    ],
    provisionalEarnings: earnings(),
    ...overrides,
  };
}

describe('provisional earnings read model', () => {
  it('keeps each currency in its own total and never produces one combined figure', () => {
    const result = earnings();
    const units = result.byCurrency.map((r) => r.unit);

    expect(units).toEqual(['NGN', 'USD']);
    // The specific defect: a single 'minor' bucket that added unlike units.
    expect(units).not.toContain('minor');

    // 500000 NGN minor + 1500 USD minor must not be reachable as one number.
    const hasCrossUnitTotal = result.byCurrency.some((r) => r.totalMinor === 500_000n + 1_500n);
    expect(hasCrossUnitTotal).toBe(false);
  });

  it('does not expose a spendable or withdrawable shape on the projection', () => {
    const totals = earnings().byCurrency as unknown as Record<string, unknown>[];
    for (const row of totals) {
      expect(row).not.toHaveProperty('availableMinor');
      expect(row).not.toHaveProperty('reservedMinor');
      expect(row).not.toHaveProperty('balanceMinor');
    }
  });

  it('is structurally separate from both balances', () => {
    const s = summary();

    // Inspect the KEYS, not a JSON dump. `JSON.stringify` throws on a raw bigint,
    // which is precisely why serializeWallet exists, so stringifying here would
    // fail for a reason unrelated to the invariant being tested.
    const keys = Object.keys(serializeWallet(s));

    expect(keys).toContain('earnedRewards');
    expect(keys).toContain('userFunding');
    expect(keys).toContain('provisionalEarnings');

    // The specific failure this guards: a merged figure across the three domains.
    expect(keys).not.toContain('total');
    expect(keys).not.toContain('grandTotal');
    expect(keys).not.toContain('balance');

    // The estimate must not have leaked into a balance.
    expect(first(s.earnedRewards, 'earnedRewards').availableMinor).toBe(600n);
    expect(first(s.userFunding, 'userFunding').availableMinor).toBe(2_000n);
  });

  it('serialises every amount as a decimal string, never a lossy number', () => {
    const json = serializeWallet(summary());

    expect(first(json.provisionalEarnings.byCurrency, 'byCurrency').totalMinor).toBe('500000');
    expect(typeof first(json.provisionalEarnings.byCurrency, 'byCurrency').totalMinor).toBe(
      'string',
    );
    expect(first(json.provisionalEarnings.recent, 'recent').estimatedMinor).toBe('250000');

    // Above 2^53 a JSON number would silently round. Assert the exact digits.
    const huge = serializeWallet(
      summary({
        provisionalEarnings: earnings({
          byCurrency: [{ unit: 'NGN', totalMinor: 9_007_199_254_740_993n, eventCount: 1 }],
        }),
      }),
    );
    expect(first(huge.provisionalEarnings.byCurrency, 'byCurrency').totalMinor).toBe(
      '9007199254740993',
    );
  });

  it('serialises an empty projection as empty, not as a zero total', () => {
    const json = serializeWallet(summary({ provisionalEarnings: { byCurrency: [], recent: [] } }));

    // A fabricated zero here would read as "you earned nothing" rather than
    // "we have nothing to show you", which are different claims.
    expect(json.provisionalEarnings.byCurrency).toEqual([]);
    expect(json.provisionalEarnings.recent).toEqual([]);
  });

  it('labels an event status as a provider report, never as confirmed payability', () => {
    const event = first(earnings().recent, 'recent');

    // VALIDATED is our adapter's classification. The type must not name it in a
    // way that implies the provider confirmed the money.
    expect(event.status).toBe('VALIDATED');
    expect(event).not.toHaveProperty('payable');
    expect(event).not.toHaveProperty('confirmed');
    expect(event).not.toHaveProperty('settled');
  });
});

describe('getWalletSummary provisional read', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    // Two calls: getUserAccounts, then getReservedByUnit.
    rpcMock.mockResolvedValue({ data: {}, error: null });
  });

  it('reads a bigint that arrives as a JSON string, which is how PostgREST sends it', async () => {
    // THE REGRESSION. PostgREST serialises bigint as a STRING because JS numbers
    // cannot hold the range. The previous implementation branched on
    // `typeof row.gross_minor === 'number'` and fell through to 0 for every real
    // row, so the estimate rendered as 0 forever with no error anywhere.
    //
    // Migration 064 groups in SQL, so one row per currency arrives. The USD row
    // is a NUMBER here to prove both transport shapes are handled; in production
    // it too would be a string.
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_wallet_summary') return Promise.resolve({ data: {}, error: null });
      return Promise.resolve({
        data: {
          byCurrency: [
            { unit: 'NGN', totalMinor: '500000', eventCount: 2 },
            { unit: 'USD', totalMinor: 1500, eventCount: 1 },
          ],
          recent: [
            {
              conversionId: 'c-1',
              providerCode: 'cpx_research',
              eventType: 'SURVEY',
              status: 'VALIDATED',
              estimatedMinor: '250000',
              currency: 'NGN',
              attributedAt: '2026-10-01T00:00:00.000Z',
            },
          ],
        },
        error: null,
      });
    });

    const result = await getWalletSummary('user-1');

    expect(result.provisionalEarnings.byCurrency).toEqual([
      { unit: 'NGN', totalMinor: 500_000n, eventCount: 2 },
      { unit: 'USD', totalMinor: 1_500n, eventCount: 1 },
    ]);
    expect(first(result.provisionalEarnings.recent, 'recent').estimatedMinor).toBe(250_000n);
  });

  it('never drops a malformed amount to a silent zero total', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_wallet_summary') return Promise.resolve({ data: {}, error: null });
      return Promise.resolve({
        data: {
          byCurrency: [{ unit: 'NGN', totalMinor: 'not-a-number', eventCount: 1 }],
          recent: [],
        },
        error: null,
      });
    });

    const result = await getWalletSummary('user-1');

    // Unparseable is not the same as zero. The projection reports zero because it
    // has no better option, but the assertion pins that behaviour so it cannot
    // quietly become a fabricated figure later.
    expect(first(result.provisionalEarnings.byCurrency, 'byCurrency').totalMinor).toBe(0n);
  });

  it('sorts currency totals so the display order is stable', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_wallet_summary') return Promise.resolve({ data: {}, error: null });
      return Promise.resolve({
        data: {
          byCurrency: [
            { unit: 'USD', totalMinor: '10', eventCount: 1 },
            { unit: 'NGN', totalMinor: '20', eventCount: 1 },
          ],
          recent: [],
        },
        error: null,
      });
    });

    const result = await getWalletSummary('user-1');
    expect(result.provisionalEarnings.byCurrency.map((r) => r.unit)).toEqual(['NGN', 'USD']);
  });

  it('still returns the real balances when the projection read fails', async () => {
    // A wallet page must not fail because ONE optional projection is down.
    // Silence the expected warning so a green run stays readable.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_wallet_summary') {
        return Promise.resolve({
          data: {
            earnedRewards: [
              { unit: 'NGN', balanceMinor: '1000', reservedMinor: '0', availableMinor: '1000' },
            ],
            userFunding: [],
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST202', message: 'no such function' },
      });
    });

    const result = await getWalletSummary('user-1');

    expect(result.earnedRewards).toHaveLength(1);
    expect(first(result.earnedRewards, 'earnedRewards').availableMinor).toBe(1_000n);
    // Empty, not zero: "nothing to show" is a different claim from "you earned 0".
    expect(result.provisionalEarnings.byCurrency).toEqual([]);
    warn.mockRestore();
  });

  it('never lets the projection create a spendable figure', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_wallet_summary') return Promise.resolve({ data: {}, error: null });
      return Promise.resolve({
        data: {
          byCurrency: [{ unit: 'NGN', totalMinor: '999999', eventCount: 3 }],
          recent: [],
        },
        error: null,
      });
    });

    const s = await getWalletSummary('user-1');

    // With zero real balances, a large estimate must not surface as one.
    expect(s.earnedRewards).toHaveLength(0);
    expect(s.userFunding).toHaveLength(0);
    expect(first(s.provisionalEarnings.byCurrency, 'byCurrency').totalMinor).toBe(999_999n);
    expect(Object.keys(serializeWallet(s))).not.toContain('total');
  });
});
