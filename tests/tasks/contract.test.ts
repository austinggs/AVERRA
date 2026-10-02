import { describe, expect, it } from 'vitest';
import {
  TASK_ATTEMPT_STATUSES,
  TASK_STATES,
  VERIFICATION_MECHANISMS,
  canAutoVerify,
  canStartTask,
  canTaskPay,
  describeRewardState,
  isAttemptOpen,
  isAttemptPaid,
  meetsMinimumDuration,
} from '@/lib/tasks/contract';

// Doc 12 VERIFICATION: "Client completion claims are evidence only, never
// sufficient for financial credit unless a server verification rule explicitly
// says so."
//
// These pin the TypeScript mirror of the two database constraints. The database
// remains the authority; these exist so the UI cannot describe a task in a way
// the database would refuse to honour.

describe('canStartTask', () => {
  it('permits only a LIVE task', () => {
    expect(canStartTask('LIVE')).toBe(true);
  });

  it('refuses every other state', () => {
    for (const state of TASK_STATES) {
      if (state === 'LIVE') continue;
      expect(canStartTask(state)).toBe(false);
    }
  });

  it('refuses a PAUSED task specifically', () => {
    expect(canStartTask('PAUSED')).toBe(false);
  });

  it('refuses a DRAFT task, which is not yet offered', () => {
    expect(canStartTask('DRAFT')).toBe(false);
  });
});

describe('canTaskPay', () => {
  it('allows a paying task with a real verification mechanism', () => {
    expect(canTaskPay({ rewardAmountMinor: 1000n, verificationMechanism: 'SERVER_RULE' })).toBe(
      true,
    );
    expect(canTaskPay({ rewardAmountMinor: 1000n, verificationMechanism: 'SERVER_EVENT' })).toBe(
      true,
    );
  });

  it('refuses a paying task with NO verification mechanism', () => {
    // This is the shape of an unverifiable payout, which law 8 forbids.
    expect(canTaskPay({ rewardAmountMinor: 1000n, verificationMechanism: 'NONE' })).toBe(false);
  });

  it('refuses a task with no reward at all', () => {
    expect(canTaskPay({ rewardAmountMinor: null, verificationMechanism: 'SERVER_RULE' })).toBe(
      false,
    );
  });

  it('refuses a zero or negative reward', () => {
    expect(canTaskPay({ rewardAmountMinor: 0n, verificationMechanism: 'SERVER_RULE' })).toBe(false);
    expect(canTaskPay({ rewardAmountMinor: -1n, verificationMechanism: 'SERVER_RULE' })).toBe(
      false,
    );
  });

  it('allows a self-attested task to exist, because it pays only after review', () => {
    // SELF_ATTESTED is a permitted mechanism. What is forbidden is AUTO-VERIFYING
    // it. Keeping those two questions separate is the point.
    expect(canTaskPay({ rewardAmountMinor: 500n, verificationMechanism: 'SELF_ATTESTED' })).toBe(
      true,
    );
  });
});

describe('canAutoVerify', () => {
  it('refuses a self-attested task even when autoVerify is set', () => {
    // The database constraint forbids this combination, so the mirror must too.
    expect(canAutoVerify({ verificationMechanism: 'SELF_ATTESTED', autoVerify: true })).toBe(false);
  });

  it('refuses a task with no verification mechanism', () => {
    expect(canAutoVerify({ verificationMechanism: 'NONE', autoVerify: true })).toBe(false);
  });

  it('permits a server-verified task that declares auto verification', () => {
    expect(canAutoVerify({ verificationMechanism: 'SERVER_EVENT', autoVerify: true })).toBe(true);
    expect(canAutoVerify({ verificationMechanism: 'SERVER_RULE', autoVerify: true })).toBe(true);
  });

  it('refuses any task that did not opt into auto verification', () => {
    expect(canAutoVerify({ verificationMechanism: 'SERVER_RULE', autoVerify: false })).toBe(false);
  });

  it('never auto-verifies SELF_ATTESTED for any autoVerify setting', () => {
    for (const autoVerify of [true, false]) {
      expect(canAutoVerify({ verificationMechanism: 'SELF_ATTESTED', autoVerify })).toBe(false);
    }
  });
});

describe('describeRewardState', () => {
  it('never describes a submitted claim as paid', () => {
    // Doc 09 TRANSPARENCY: "sent", "detected" and "verified" are not "credited".
    const described = describeRewardState({ status: 'SUBMITTED', hasReward: false });
    expect(described.settled).toBe(false);
    expect(described.label).toMatch(/awaiting verification/i);
  });

  it('says plainly that a rejection paid nothing', () => {
    expect(describeRewardState({ status: 'REJECTED', hasReward: false }).label).toMatch(
      /no reward was paid/i,
    );
  });

  it('says plainly that an expiry paid nothing', () => {
    expect(describeRewardState({ status: 'EXPIRED', hasReward: false }).label).toMatch(
      /no reward was paid/i,
    );
  });

  it('never marks any attempt settled, because settlement is a separate step', () => {
    for (const status of TASK_ATTEMPT_STATUSES) {
      expect(describeRewardState({ status, hasReward: true }).settled).toBe(false);
    }
  });

  it('describes a verified attempt with a reward', () => {
    expect(describeRewardState({ status: 'VERIFIED', hasReward: true }).label).toMatch(
      /reward added/i,
    );
  });
});

describe('attempt states', () => {
  it('treats a started, submitted or reviewing attempt as open', () => {
    expect(isAttemptOpen('STARTED')).toBe(true);
    expect(isAttemptOpen('SUBMITTED')).toBe(true);
    expect(isAttemptOpen('UNDER_REVIEW')).toBe(true);
  });

  it('treats a terminal attempt as closed', () => {
    expect(isAttemptOpen('VERIFIED')).toBe(false);
    expect(isAttemptOpen('REJECTED')).toBe(false);
    expect(isAttemptOpen('EXPIRED')).toBe(false);
  });

  it('treats only VERIFIED as paid', () => {
    for (const status of TASK_ATTEMPT_STATUSES) {
      expect(isAttemptPaid(status)).toBe(status === 'VERIFIED');
    }
  });
});

describe('meetsMinimumDuration', () => {
  it('accepts any duration when no minimum is set', () => {
    expect(meetsMinimumDuration(0, 0)).toBe(true);
  });

  it('accepts a duration at or above the minimum', () => {
    expect(meetsMinimumDuration(60, 60)).toBe(true);
    expect(meetsMinimumDuration(61, 60)).toBe(true);
  });

  it('rejects an impossibly fast completion', () => {
    expect(meetsMinimumDuration(2, 60)).toBe(false);
  });
});

describe('enum vocabulary', () => {
  it('matches the doc 12 task states', () => {
    expect([...TASK_STATES]).toEqual([
      'DRAFT',
      'SCHEDULED',
      'LIVE',
      'PAUSED',
      'EXPIRED',
      'ARCHIVED',
    ]);
  });

  it('includes every doc 12 verification mechanism', () => {
    expect([...VERIFICATION_MECHANISMS]).toEqual([
      'SERVER_EVENT',
      'SERVER_RULE',
      'SELF_ATTESTED',
      'NONE',
    ]);
  });
});
