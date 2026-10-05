// Provider adapter contract.
//
// Spec: 08_PROVIDER_INTEGRATION.txt ADAPTER INTERFACE,
//       06_PROVIDER_ECOSYSTEM.txt ARCHITECTURE,
//       71_ARCHITECTURAL_LAWS.md law 12.
//
// WHY AN INTERFACE AND NOT A SWITCH STATEMENT
//
// Law 12 requires provider integrations to be replaceable. A registry of
// adapters keyed by provider code satisfies that: business logic consumes
// NORMALIZED capabilities, statuses and events, so swapping a vendor touches
// configuration and one adapter file, never the reward engine or the ledger.
//
// This module is PURE and free of `server-only` so the contract can be unit
// tested without a database or a network.

/** Doc 06 PROVIDER CLASSES, modelled by capability rather than vendor name. */
export const PROVIDER_CLASSES = [
  'SURVEY',
  'OFFERWALL',
  'CPA',
  'TASK',
  'REWARDED_CONTENT',
  'ADVERTISING',
  'RESEARCH',
] as const;
export type ProviderClass = (typeof PROVIDER_CLASSES)[number];

/** Doc 06 LIFECYCLE. REJECTED and RETIRED are not live states. */
export const PROVIDER_STATES = [
  'CANDIDATE',
  'APPLIED',
  'APPROVED',
  'INTEGRATION_TESTING',
  'LIVE',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

/**
 * States that may produce a reward.
 *
 * A callback from a provider in any other state is recorded as evidence and
 * ignored for reward purposes. This is why a SUSPENDED provider's postback
 * cannot mint value.
 */
const REWARD_PERMITTED_STATES: readonly ProviderState[] = ['LIVE'];

export function canProduceReward(state: ProviderState): boolean {
  return REWARD_PERMITTED_STATES.includes(state);
}

export const PARTICIPATION_STATUSES = [
  'STARTED',
  'QUALIFYING',
  'QUALIFIED',
  'INELIGIBLE',
  'COMPLETED',
  'VERIFIED',
  'FAILED',
] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const CONVERSION_STATUSES = [
  'RECEIVED',
  'VALIDATED',
  'REJECTED',
  'CONVERTED',
  'REVERSED',
  'CHARGEBACK',
] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export type SourceType = 'OFFER' | 'SURVEY' | 'TASK' | 'REFERRAL' | 'GAME' | 'ADVERTISER_CAMPAIGN';

export type VerificationResult = 'VERIFIED' | 'FAILED' | 'ABSENT' | 'UNSUPPORTED';

export type NormalizationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type NormalizedAmount = {
  amountMinor: bigint;
  currency: string;
  error?: string;
};

export type TrackingLinkInput = {
  externalId: string;
  trackingId: string;
  userId?: string;
  subId?: string;
  /**
   * Where to send the user, read from OUR `offers.tracking_base_url`.
   *
   * REQUIRED, and that is the point: an adapter cannot invent a destination. If this
   * were optional and a caller supplied the URL instead, a compromised or careless
   * caller could send users anywhere while the participation recorded a real one, and the
   * postback would attribute the conversion to that offer. The base URL is configuration
   * we own, looked up by offer id.
   */
  baseUrl?: string;
};

export type TrackingLink = { url: string; trackingId: string };

export type AdapterContext = {
  providerCode: string;
  trackingId: string;
  countries?: string[];
  device?: string;
  signal?: AbortSignal;
};

export type RawCallback = {
  providerCode: string;
  body: Record<string, unknown>;
  rawBody: string;
  headers: Record<string, string>;
  receivedAt: Date;
  remoteAddress?: string | null;
  signature: string | null;
};

export type CallbackVerification = {
  result: VerificationResult;
  reason?: string;
  algorithm?: string;
  claimedTimestamp?: Date | null;
};

/** Doc 08 NORMALIZED EVENT. */
export type NormalizedCallbackEvent = {
  providerEventId: string;
  /**
   * When this event REVERSES an earlier one, the provider's own id for the transaction
   * being withdrawn. Null on an ordinary event.
   *
   * This is deliberately NOT a conversion id. The adapter only reads the provider's
   * payload, so it cannot know which of our rows that transaction became - and it must
   * not be allowed to guess. Resolution happens in `record_provider_conversion`, in the
   * same transaction as the insert, where the link is authoritative.
   */
  reversesTransactionId?: string | null;
  sourceType: SourceType;
  campaignRef: string | null;
  userId: string | null;
  trackingId: string | null;
  eventType: string;
  status: ConversionStatus;
  grossValueMinor: bigint | null;
  currency: string | null;
  eventTimestamp: Date | null;
  normalizedPayload: Record<string, unknown>;
};

export type NormalizedOffer = {
  externalId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  countries: string[];
  devices: string[];
  displayedPayoutMinor: bigint | null;
  displayedPayoutCurrency: string | null;
  conditions?: string | null;
  raw: Record<string, unknown>;
};

export type NormalizedSurvey = {
  externalId: string;
  title: string;
  description?: string | null;
  categories: string[];
  languages: string[];
  countries: string[];
  estimatedDurationSeconds: number | null;
  baseRewardMinor: bigint | null;
  rewardCurrency: string | null;
  raw: Record<string, unknown>;
};

export type ReconciliationInput = {
  providerCode: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
};

export type ReconciliationReport = {
  reportedAmountMinor: bigint;
  reportedConversionCount: number;
  /** Mismatches to investigate, never auto-corrected. */
  discrepancies: Array<{
    kind: 'MISSING_LOCAL' | 'MISSING_PROVIDER' | 'AMOUNT_MISMATCH';
    reference: string;
    detail: string;
  }>;
};

/**
 * A provider adapter.
 *
 * The method set is Partial rather than total. Forcing a survey-only vendor to
 * implement `getOffers` would be noise, and implementing it as a stub that
 * returns empty data invites a caller to believe it was actually asked.
 */
export type ProviderAdapter = Partial<{
  getOffers(context: AdapterContext): Promise<NormalizedOffer[]>;
  getSurveys(context: AdapterContext): Promise<NormalizedSurvey[]>;
  createTrackingLink(input: TrackingLinkInput): Promise<TrackingLink>;
  handleCallback(input: RawCallback): Promise<NormalizedCallbackEvent | null>;

  /**
   * Authenticates a callback. MUST fail closed. An implementation that cannot
   * verify a signature returns 'UNSUPPORTED', never 'VERIFIED'.
   */
  verifyCallback(input: RawCallback): Promise<CallbackVerification>;

  normalizeReward(value: unknown, currency: string): NormalizedAmount;
  normalizeStatus(value: unknown): NormalizationResult<ConversionStatus>;
  reconcile(input: ReconciliationInput): Promise<ReconciliationReport>;
}>;
