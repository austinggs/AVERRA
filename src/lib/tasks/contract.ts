// Native task contract.
//
// Spec: 12_TASK_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md laws 8/12.
//
// PURE and free of `server-only` so the rules are unit testable.
//
// THE CENTRAL RULE
//
// Doc 12 VERIFICATION: "Client completion claims are evidence only, never
// sufficient for financial credit unless a server verification rule explicitly
// says so."
//
// `canTaskPay` and `canAutoVerify` below are the TypeScript mirror of two
// database constraints. They exist so the user-facing layer can explain a task
// honestly BEFORE an attempt starts, not so it can decide anything. The database
// is what enforces them.

/** Doc 12 TASK STATES. */
export const TASK_STATES = ['DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Doc 12: each task type declares its verification mechanism. */
export const VERIFICATION_MECHANISMS = [
  'SERVER_EVENT',
  'SERVER_RULE',
  'SELF_ATTESTED',
  'NONE',
] as const;
export type VerificationMechanism = (typeof VERIFICATION_MECHANISMS)[number];

export const TASK_ATTEMPT_STATUSES = [
  'STARTED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'ABANDONED',
] as const;
export type TaskAttemptStatus = (typeof TASK_ATTEMPT_STATUSES)[number];

/** Only these states may be started. Doc 12 states availability is config-driven. */
const STARTABLE_STATES: readonly TaskState[] = ['LIVE'];

/** Only these states are still open. */
const OPEN_ATTEMPT_STATUSES: readonly TaskAttemptStatus[] = [
  'STARTED',
  'SUBMITTED',
  'UNDER_REVIEW',
];

/** A reward only exists once the attempt is VERIFIED, never on submission. */
const PAID_ATTEMPT_STATUSES: readonly TaskAttemptStatus[] = ['VERIFIED'];

export function canStartTask(state: TaskState): boolean {
  return STARTABLE_STATES.includes(state);
}

export function isAttemptOpen(status: TaskAttemptStatus): boolean {
  return OPEN_ATTEMPT_STATUSES.includes(status);
}

export function isAttemptPaid(status: TaskAttemptStatus): boolean {
  return PAID_ATTEMPT_STATUSES.includes(status);
}

/**
 * Mirrors `task_definitions_paying_task_needs_verification`.
 *
 * A task that pays must declare how it is verified. Without this rule a task
 * could offer money against no evidence at all, which is what law 8 forbids.
 */
export function canTaskPay(input: {
  rewardAmountMinor: bigint | null;
  verificationMechanism: VerificationMechanism;
}): boolean {
  if (input.rewardAmountMinor === null || input.rewardAmountMinor <= 0n) {
    return false;
  }

  return input.verificationMechanism !== 'NONE';
}

/**
 * Mirrors `task_definitions_self_attested_never_auto_verifies`.
 *
 * A self-attested task can never be auto-verified. A client claim is evidence,
 * not proof, so somebody or something on the server has to decide.
 */
export function canAutoVerify(input: {
  verificationMechanism: VerificationMechanism;
  autoVerify: boolean;
}): boolean {
  if (input.verificationMechanism === 'SELF_ATTESTED') return false;
  if (input.verificationMechanism === 'NONE') return false;
  return input.autoVerify;
}

/**
 * What the user should be told about a task's reward.
 *
 * Doc 13 PRESENTATION forbids overstating certainty, and doc 09 TRANSPARENCY
 * requires that "submitted" is never described as "credited".
 */
export function describeRewardState(input: { status: TaskAttemptStatus; hasReward: boolean }): {
  label: string;
  settled: boolean;
} {
  if (input.hasReward && input.status === 'VERIFIED') {
    return { label: 'Reward added', settled: false };
  }

  switch (input.status) {
    case 'STARTED':
      return { label: 'Not started', settled: false };
    case 'SUBMITTED':
      return { label: 'Submitted, awaiting verification', settled: false };
    case 'UNDER_REVIEW':
      return { label: 'Under review', settled: false };
    case 'VERIFIED':
      return { label: 'Verified', settled: false };
    case 'REJECTED':
      return { label: 'Rejected. No reward was paid.', settled: false };
    case 'EXPIRED':
      return { label: 'Expired. No reward was paid.', settled: false };
    case 'ABANDONED':
      return { label: 'Abandoned. No reward was paid.', settled: false };
    default:
      return { label: 'Status unavailable', settled: false };
  }
}

/**
 * Doc 12 ABUSE CONTROLS: impossible-time check.
 *
 * The duration is the SERVER's measurement. A client-supplied timer is an
 * assertion stored as evidence and is deliberately not a parameter here, so a
 * forged clock cannot shorten a required minimum.
 */
export function meetsMinimumDuration(
  serverDurationSeconds: number,
  minDurationSeconds: number,
): boolean {
  if (minDurationSeconds <= 0) return true;
  return serverDurationSeconds >= minDurationSeconds;
}
