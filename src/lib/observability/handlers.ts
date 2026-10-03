import 'server-only';
import { notifyStateChange } from '@/lib/notifications/service';
import { metrics } from '@/lib/observability/logger';
import { readString, readAmount, describeAmount } from '@/lib/observability/payload';

// Outbox event handlers.
//
// These produce NOTIFICATIONS only. No handler mutates a balance, approves a
// deposit, or settles a payout: those are financial commands and belong behind
// their own capability-gated endpoints. A notification is a downstream
// consequence of a decision that has already been made and committed.
//
// Every handler must be IDEMPOTENT. The same event may be delivered more than
// once after a lease expiry or a crash, and re-running a handler must not
// produce a duplicate notification, because notifyStateChange is itself keyed on
// the source event.

export type OutboxEvent = {
  id: number;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

export type Handler = (event: OutboxEvent) => Promise<void>;

export const handlers: Record<string, Handler> = {
  'deposit.confirmed': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) throw new Error('deposit.confirmed is missing userId');

    const amount = readAmount(event.payload, 'amountMinor');
    const unit = readString(event.payload, 'unit');
    const depositId = event.aggregate_id ?? String(event.id);

    await notifyStateChange({
      userId,
      category: 'DEPOSIT',
      title: 'Deposit confirmed',
      body:
        'Your deposit has been confirmed and credited to your User Funding Balance. ' +
        'It is now available for approved platform purchases.',
      sourceEventType: 'deposit.confirmed',
      sourceId: depositId,
      actionPath: '/wallet',
      actionLabel: 'View wallet',
    });

    if (amount !== null && unit) {
      metrics.depositConfirmed({ userId, amountMinor: amount, unit });
    }
  },

  'deposit.verified': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) return;

    const depositId = event.aggregate_id ?? String(event.id);

    await notifyStateChange({
      userId,
      category: 'DEPOSIT',
      title: 'Deposit under verification',
      body:
        'We received your transaction hash and your deposit is being verified. ' +
        'It becomes available only after verification and an authorised confirmation.',
      sourceEventType: 'deposit.verified',
      sourceId: depositId,
      actionPath: '/wallet',
      actionLabel: 'View deposit',
    });
  },

  'withdrawal.requested': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) throw new Error('withdrawal.requested is missing userId');

    const gross = readAmount(event.payload, 'grossMinor');
    const fee = readAmount(event.payload, 'feeMinor');
    const net = readAmount(event.payload, 'netMinor');
    const unit = readString(event.payload, 'unit');
    const withdrawalId = event.aggregate_id ?? String(event.id);

    // The fee breakdown is repeated here on purpose. A user who did not read the
    // confirmation screen must still see gross, fee and net (law 45).
    const breakdown =
      gross !== null && fee !== null && net !== null && unit
        ? ` Gross ${gross} ${unit}, Platform Service and Maintenance Fee ${fee} ${unit}, net payout ${net} ${unit}.`
        : '';

    await notifyStateChange({
      userId,
      category: 'WITHDRAWAL',
      title: 'Withdrawal request received',
      body: 'Your withdrawal request has been received and is awaiting review.' + breakdown,
      sourceEventType: 'withdrawal.requested',
      sourceId: withdrawalId,
      actionPath: '/wallet',
      actionLabel: 'View withdrawal',
    });

    if (gross !== null && fee !== null && net !== null && unit) {
      metrics.withdrawalRequested({
        userId,
        grossMinor: gross,
        feeMinor: fee,
        netMinor: net,
        unit,
      });
    }
  },

  'reward.granted': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) return;

    const amount = readAmount(event.payload, 'amountMinor');
    const unit = readString(event.payload, 'unit');
    const state = readString(event.payload, 'state');
    const rewardId = event.aggregate_id ?? String(event.id);

    await notifyStateChange({
      userId,
      category: 'REWARD',
      title: 'Reward added',
      // An ON_HOLD reward must not be described as available money (law 6).
      body:
        state === 'ON_HOLD'
          ? 'A reward from your activity is on hold pending review. It is not yet available.'
          : 'A reward from your activity has been added. It becomes withdrawable once it settles.',
      sourceEventType: 'reward.granted',
      sourceId: rewardId,
      actionPath: '/wallet',
      actionLabel: 'View rewards',
    });

    if (amount !== null && unit) {
      metrics.rewardGranted({ userId, amountMinor: amount, unit, state: state ?? 'PENDING' });
    }
  },

  'reward.reversed': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) return;

    const reason = readString(event.payload, 'reasonCode') ?? 'not specified';
    const amount = readAmount(event.payload, 'amountMinor');
    const rewardId = event.aggregate_id ?? String(event.id);

    // A reversal is user-visible and must never be silent (law 7).
    await notifyStateChange({
      userId,
      category: 'REWARD',
      title: 'Reward reversed',
      body: `A reward of ${describeAmount(amount, unitOf(event))} was reversed (${reason}). Your balance reflects the change.`,
      sourceEventType: 'reward.reversed',
      sourceId: rewardId,
      actionPath: '/wallet',
      actionLabel: 'View rewards',
    });

    if (amount !== null) {
      metrics.rewardReversed({ rewardId, amountMinor: amount, reason });
    }
  },

  'review.comment.added': async (event) => {
    // Migration 042 trigger. Fires for every reply, including a reply-to-a-reply.
    const reviewAuthorId = readString(event.payload, 'reviewAuthorId');
    const commentId = readString(event.payload, 'commentId');
    const reviewId = readString(event.payload, 'reviewId');

    if (!reviewAuthorId || !commentId || !reviewId) {
      // A malformed event is not retryable forever, but throwing lets the outbox
      // record the error, which is what makes it diagnosable.
      throw new Error('review.comment.added is missing required payload fields');
    }

    const reviewTitle = readString(event.payload, 'reviewTitle');

    // Factual, fixed wording. Never generated text, never a quote of the
    // comment - the comment is still PENDING when this runs, so its content has
    // not been moderated and must not appear in a notification (doc 86 PRIVACY).
    await notifyStateChange({
      userId: reviewAuthorId,
      category: 'COMMUNITY',
      title: 'New reply on your review',
      body:
        'Someone replied to your review' +
        (reviewTitle ? ` "${reviewTitle}"` : '') +
        '. Open your reviews to read and reply.',
      sourceEventType: 'review.comment.added',
      // Keyed on the COMMENT, not the review, so a second and third reply each
      // produce their own notification instead of deduplicating into one.
      sourceId: commentId,
      actionPath: '/reviews/mine',
      actionLabel: 'View your reviews',
    });
  },

  'withdrawal.settled': async (event) => {
    const userId = readString(event.payload, 'userId');
    if (!userId) return;

    const net = readAmount(event.payload, 'netMinor');
    const unit = readString(event.payload, 'unit');
    const withdrawalId = event.aggregate_id ?? String(event.id);

    await notifyStateChange({
      userId,
      category: 'WITHDRAWAL',
      title: 'Withdrawal paid',
      body: `Your withdrawal of ${describeAmount(net, unit)} has been paid out.`,
      sourceEventType: 'withdrawal.settled',
      sourceId: withdrawalId,
      actionPath: '/wallet',
      actionLabel: 'View wallet',
    });

    if (net !== null && unit) {
      metrics.withdrawalSettled({ userId, netMinor: net, unit });
    }
  },
};

function unitOf(event: OutboxEvent): string | null {
  return readString(event.payload, 'unit');
}
