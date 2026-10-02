// Canonical domain state machines.
//
// These MUST mirror the database enum types created in migration 001. The database
// is authoritative; this module exists so server and client code cannot drift into
// hand-written string literals.
//
// Source of truth:
//   35_REWARD_ENGINE.txt         reward_state
//   37_WITHDRAWAL_SYSTEM.txt     withdrawal_status, payment_settlement_status
//   38_PAYMENT_OPERATIONS.txt    deposit_status, deposit_event_type
//   87_ADMIN_PORTAL_EXPANDED.md  reconciliation_status
//   48_DATABASE_SCHEMA.txt       enum namespacing rule
//
// NAMESPACING RULE: reward_state and withdrawal_status are separate machines and
// must never be merged into one shared enum. ELIGIBILITY_CHECKED is a withdrawal
// status only; the reward enum uses ELIGIBLE (see Q-08 in docs/DISCREPANCIES.md).

export const REWARD_STATES = [
  'ELIGIBLE',
  'PENDING',
  'AVAILABLE',
  'ON_HOLD',
  'REVERSED',
  'CHARGEBACK',
  'CANCELLED',
  'EXPIRED',
] as const;
export type RewardState = (typeof REWARD_STATES)[number];

export const WITHDRAWAL_STATUSES = [
  'REQUESTED',
  'ELIGIBILITY_CHECKED',
  'RISK_REVIEW',
  'APPROVED',
  'PROCESSING',
  'PAYMENT_INITIATED',
  'CONFIRMED',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const PAYMENT_SETTLEMENT_STATUSES = [
  'NOT_STARTED',
  'INITIATED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'SETTLEMENT_FAILED',
  'REVERSED',
] as const;
export type PaymentSettlementStatus = (typeof PAYMENT_SETTLEMENT_STATUSES)[number];

export const RECONCILIATION_STATUSES = ['PENDING', 'MATCHED', 'VARIANCE', 'RESOLVED'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const DEPOSIT_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'VERIFIED',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
  'NEEDS_REVIEW',
  'CANCELLED',
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const DEPOSIT_EVENT_TYPES = [
  'CREATED',
  'SUBMITTED',
  'DETECTED',
  'VERIFIED',
  'NEEDS_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type DepositEventType = (typeof DEPOSIT_EVENT_TYPES)[number];

// --- Deposit lifecycle (doc 38 / doc 84) -------------------------------------
// There is deliberately no PENDING -> CONFIRMED edge: a client cannot self-credit.
const DEPOSIT_TRANSITIONS: Record<DepositStatus, readonly DepositStatus[]> = {
  PENDING: ['SUBMITTED', 'EXPIRED', 'CANCELLED'],
  SUBMITTED: ['VERIFIED', 'NEEDS_REVIEW', 'EXPIRED', 'REJECTED'],
  VERIFIED: ['CONFIRMED', 'NEEDS_REVIEW', 'REJECTED'],
  NEEDS_REVIEW: ['VERIFIED', 'CONFIRMED', 'REJECTED'],
  CONFIRMED: [],
  REJECTED: [],
  EXPIRED: ['NEEDS_REVIEW'],
  CANCELLED: [],
};

export function canTransitionDeposit(from: DepositStatus, to: DepositStatus): boolean {
  return DEPOSIT_TRANSITIONS[from].includes(to);
}

// Only CONFIRMED is ever creditable (doc 38: "Only CONFIRMED is creditable").
export function isDepositCreditable(status: DepositStatus): boolean {
  return status === 'CONFIRMED';
}

// --- Withdrawal lifecycle (doc 37 + ADR-0003) --------------------------------
const WITHDRAWAL_TRANSITIONS: Record<WithdrawalStatus, readonly WithdrawalStatus[]> = {
  REQUESTED: ['ELIGIBILITY_CHECKED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ELIGIBILITY_CHECKED: ['RISK_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  RISK_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'FAILED', 'CANCELLED'],
  PROCESSING: ['PAYMENT_INITIATED', 'FAILED'],
  PAYMENT_INITIATED: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['COMPLETED'],
  COMPLETED: [],
  FAILED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransitionWithdrawal(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
  return WITHDRAWAL_TRANSITIONS[from].includes(to);
}

// APPROVED never means PAID. CONFIRMED never means RECONCILED.
export const TERMINAL_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = [
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
];

export function isWithdrawalTerminal(status: WithdrawalStatus): boolean {
  return TERMINAL_WITHDRAWAL_STATUSES.includes(status);
}
