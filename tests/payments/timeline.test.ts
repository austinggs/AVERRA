import { describe, expect, it } from 'vitest';
import { buildDepositTimeline } from '@/lib/deposits/timeline';

// The deposit timeline used to be a read of app.deposit_events. That read could
// not have worked, because the `app` schema is not exposed through the Data API,
// so the timeline is now derived from the deposit's own timestamps.
//
// That makes these tests load-bearing in a way the other pure tests are not: the
// code under test was written to replace something that silently produced nothing.
// There is no database assertion behind it yet, so if this logic is wrong the UI
// shows a user a deposit history that never existed.

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:05:00.000Z';
const T2 = '2026-01-01T00:10:00.000Z';
const T3 = '2026-01-01T00:15:00.000Z';

describe('buildDepositTimeline', () => {
  it('lists only REQUESTED for a deposit that was never submitted', () => {
    // Doc 09 TRANSPARENCY: "sent", "detected" and "credited" are not the same
    // thing. A PENDING deposit has exactly one milestone, and inventing the rest
    // would tell the user their payment was verified when nothing has happened.
    const timeline = buildDepositTimeline({ requestedAt: T0 }, 'PENDING');

    expect(timeline).toEqual([{ event: 'REQUESTED', source: 'USER', at: T0 }]);
  });

  it('does not show a verification the deposit has not had', () => {
    const timeline = buildDepositTimeline({ requestedAt: T0, submittedAt: T1 }, 'SUBMITTED');

    expect(timeline.map((entry) => entry.event)).toEqual(['REQUESTED', 'SUBMITTED']);
  });

  it('attributes verification to the chain, never to the user', () => {
    // Law 44. Verification is performed independently against the network. If a
    // timeline implied the user vouched for their own settlement, the whole
    // custody chain would be misrepresented.
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T1, verifiedAt: T2 },
      'VERIFIED',
    );

    const verified = timeline.find((entry) => entry.event === 'VERIFIED');

    expect(verified?.source).toBe('CHAIN');
  });

  it('never attributes confirmation to the user', () => {
    // Only an authorised human confirms a deposit (law 41). If this ever read
    // USER, the UI would imply a user credited themselves.
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T1, verifiedAt: T2, confirmedAt: T3 },
      'CONFIRMED',
    );

    const confirmed = timeline.find((entry) => entry.event === 'CONFIRMED');

    expect(confirmed?.source).toBe('ADMIN');
  });

  it('orders the full happy path oldest first', () => {
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T1, verifiedAt: T2, confirmedAt: T3 },
      'CONFIRMED',
    );

    expect(timeline.map((entry) => entry.event)).toEqual([
      'REQUESTED',
      'SUBMITTED',
      'VERIFIED',
      'CONFIRMED',
    ]);
  });

  it('records a human escalation for a deposit sent to review', () => {
    // NEEDS_REVIEW exists so a human decides. It must be visible to the user as
    // a human step, not silently swallowed.
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T1, verifiedAt: T2 },
      'NEEDS_REVIEW',
    );

    const review = timeline.find((entry) => entry.event === 'NEEDS_REVIEW');

    expect(review?.source).toBe('ADMIN');
  });

  it('records a rejection as a human decision', () => {
    // A rejected deposit was never credited, and the user is entitled to see that
    // a person decided it rather than a timeout.
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T1, verifiedAt: T2 },
      'REJECTED',
    );

    const rejected = timeline.find((entry) => entry.event === 'REJECTED');

    expect(rejected?.source).toBe('ADMIN');
    expect(timeline.some((entry) => entry.event === 'CONFIRMED')).toBe(false);
  });

  it('never invents a CONFIRMED entry for an unconfirmed deposit', () => {
    // The single most dangerous output of this function would be a CONFIRMED
    // milestone on a deposit that was not credited, because a green "credited"
    // state in the UI is indistinguishable from money.
    for (const status of ['PENDING', 'SUBMITTED', 'VERIFIED', 'NEEDS_REVIEW', 'REJECTED']) {
      const timeline = buildDepositTimeline(
        { requestedAt: T0, submittedAt: T1, verifiedAt: T2 },
        status,
      );

      expect(timeline.some((entry) => entry.event === 'CONFIRMED')).toBe(false);
    }
  });

  it('places a rejection at or after the request, never before it', () => {
    // There is no escalated_at column, so the rejection falls back to the last
    // known moment. Every such moment must be inside the deposit's lifetime.
    const timeline = buildDepositTimeline({ requestedAt: T0 }, 'REJECTED');
    const rejected = timeline.find((entry) => entry.event === 'REJECTED');

    expect(rejected?.at).toBe(T0);
    // REQUESTED is unconditional, so index 0 always exists. Asserted rather than
    // optional-chained so a refactor that makes it conditional fails here.
    expect(timeline[0]?.event).toBe('REQUESTED');
  });

  it('sorts by time even when the columns arrive out of order', () => {
    // The stages come from independent columns rather than from an event log's
    // own ordering, so without an explicit sort a deposit with an out-of-order
    // confirmation timestamp would render backwards.
    const timeline = buildDepositTimeline(
      { requestedAt: T0, submittedAt: T2, verifiedAt: T1, confirmedAt: T3 },
      'CONFIRMED',
    );

    expect(timeline.map((entry) => entry.event)).toEqual([
      'REQUESTED',
      'VERIFIED',
      'SUBMITTED',
      'CONFIRMED',
    ]);
  });
});
