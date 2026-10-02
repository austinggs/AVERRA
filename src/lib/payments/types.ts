// Payment operations adapter contract.
//
// Spec: 38_PAYMENT_OPERATIONS.txt METHODS,
//       37_WITHDRAWAL_SYSTEM.txt FLOW,
//       71_ARCHITECTURAL_LAWS.md law 40, law 22, law 12.
//
// WHY AN INTERFACE FOR PAYMENTS TOO
//
// The award/offerwall side already uses a provider adapter registry (law 12).
// The PAYMENT side needs the same discipline for the opposite reason: an
// outbound payout adapter is code that sends real money to a real destination.
// A vendor-neutral interface means the payment operations engine never learns a
// vendor's request format, so replacing Daimo with another rail touches one file.
//
// LAW 40 IS THE CONSTRAINT THAT SHAPES THIS FILE
//
// "Automatic Daimo never silently falls back to a manual method."
//
// So `PaymentAdapter` has NO optional methods and NO default implementation. An
// adapter either implements the full automatic contract, or it does not exist
// and the method stays MANUAL_OPERATOR. There is no code path where a configured
// automatic method quietly degrades into a human paying out from a different pot.
//
// LAW 22: a MANUAL method is actually manual. It is performed by a named human
// operator, and `ManualExecution` carries that operator identity. Nothing here
// automates a manual method.

/** Doc 38 OUTBOUND and INBOUND methods. */
export const PAYMENT_METHODS = ['MINIPAY_MANUAL', 'BANK_MANUAL', 'CRYPTO_AUTOMATIC_DAIMO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INBOUND_METHODS = [
  'MANUAL_MINIPAY_CRYPTO',
  'DAIMO_CRYPTO_DEPOSIT',
  'MINIPAY_CASH_LINK',
] as const;
export type InboundMethod = (typeof INBOUND_METHODS)[number];

/**
 * Execution attribution.
 *
 * `MANUAL_OPERATOR` is a person. `AUTOMATIC_ADAPTER` is a vendor. The value is
 * recorded on `payment_operations.execution_mode`, and the database constraint
 * requires the matching attribution: an automatic operation MUST name its
 * adapter, a manual one MUST name its human. This type makes the compiler
 * enforce the same pairing.
 */
export type ExecutionMode = 'MANUAL_OPERATOR' | 'AUTOMATIC_ADAPTER';

export function executionModeFor(method: PaymentMethod): ExecutionMode {
  return method === 'CRYPTO_AUTOMATIC_DAIMO' ? 'AUTOMATIC_ADAPTER' : 'MANUAL_OPERATOR';
}

/** Doc 38: MiniPay Cash Link is "a separately approved flow". */
export function isSeparatelyApprovedFlow(method: InboundMethod): boolean {
  return method === 'MINIPAY_CASH_LINK';
}

/**
 * A payout an adapter was asked to perform.
 *
 * `amountMinor` is an integer in the source unit. The fee has ALREADY been split
 * by `quoteWithdrawal`, so this is the NET payout. An adapter that re-derives a
 * fee would double-charge, which is why the net figure is passed rather than the
 * gross.
 */
export interface PayoutRequest {
  operationId: string;
  /** Net payout, after the disclosed fee. Never the gross. */
  amountMinor: bigint;
  unit: string;
  /** The verified destination. An adapter must not invent one. */
  destinationAddress: string;
  /** Outbound idempotency key. The adapter must honour it. */
  idempotencyKey: string;
  correlationId?: string;
}

export interface PayoutResult {
  /** The vendor's own reference for this payout, for reconciliation. */
  providerReference: string;
  /** Vendor-reported state. Normalized by the caller, never trusted as truth. */
  status: 'ACCEPTED' | 'SUBMITTED' | 'REJECTED';
  /** Present when the vendor refused it. Recorded, never silently retried. */
  failureReason?: string;
  raw: Record<string, unknown>;
}

/**
 * The automatic payout adapter.
 *
 * NOTE WHAT IS ABSENT: there is no `manualFallback`, no `tryAlternate`, no
 * optional `send`. Law 40 is enforced by the shape of this interface. If a
 * vendor is unavailable, the operation stays pending for a human or fails
 * visibly; it never reroutes to a different rail.
 */
export interface PaymentAdapter {
  readonly providerCode: string;

  /**
   * Initiates a payout. Must be idempotent on `idempotencyKey`: a retry with
   * the same key must return the same providerReference and must not pay twice.
   */
  sendPayout(request: PayoutRequest): Promise<PayoutResult>;

  /**
   * Reads the current state of a previously submitted payout, for
   * reconciliation. Read-only: this must never initiate a payment.
   */
  getPayoutStatus(
    providerReference: string,
  ): Promise<{ status: string; raw: Record<string, unknown> }>;
}

/**
 * A manual execution record.
 *
 * Doc 38 records "who did it, and the external reference they observed". The
 * operator identity is required, not optional: an unattributed manual payout is
 * unauditable.
 */
export interface ManualExecution {
  operatorId: string;
  completedAt: Date;
  /** What the operator saw: a bank receipt, a MiniPay confirmation. */
  externalReference: string;
  evidence?: Record<string, unknown>;
}

/**
 * Why an adapter is not usable.
 *
 * This is a distinct state from "the payout failed". An unconfigured provider
 * cannot fail a payout it never accepted; the correct behaviour is to report it
 * unavailable and let the operation remain pending for a human.
 */
export type AdapterAvailability = { available: true } | { available: false; reason: string };

/** Doc 38 lists no fourth outbound method. Adding one requires a spec change. */
export function isAutomaticMethod(method: PaymentMethod): boolean {
  return executionModeFor(method) === 'AUTOMATIC_ADAPTER';
}
