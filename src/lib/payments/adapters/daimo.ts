import type { PaymentAdapter, PayoutRequest, PayoutResult } from '../types';

// Daimo crypto payout adapter.
//
// THIS ADAPTER CANNOT SEND MONEY TODAY, AND THAT IS DELIBERATE.
//
// Doc 78 forbids inventing provider behaviour. A real Daimo adapter must be
// written against Daimo's own published API documentation, authenticated with
// real credentials, and tested against their sandbox. None of that has happened,
// so this file contains no request format, no endpoint, and no signature scheme
// for Daimo specifically. Inventing one would produce code that looks integrated
// and fails silently in production, which is worse than not existing.
//
// What this file DOES provide is the honest port implementation: it satisfies
// `PaymentAdapter` and REFUSES every call with an explicit reason. That means:
//
//   - the registry has a registered code, so routing is exercised
//   - `availabilityFor` reports unavailable rather than pretending
//   - a caller that ignores availability gets a loud failure, not a silent no-op
//   - the seam is proven before any real credential exists
//
// The shape to replace: implement `sendPayout` and `getPayoutStatus` against
// Daimo's real documentation, and register the result. Nothing else changes.
//
// LAW 40: this adapter has no manual fallback. A Daimo outage leaves the
// operation pending for an operator. It does not become a manual payout.

/** Set only once real credentials and a verified API integration exist. */
const DAIMO_API_KEY = process.env.DAIMO_API_KEY ?? null;

const NOT_INTEGRATED =
  'Daimo is not integrated. No API credentials, no published-request verification and ' +
  'no sandbox testing have been completed. This operation must remain pending for a ' +
  'human operator and must NOT be rerouted to a manual payout (law 40).';

export function createDaimoAdapter(): PaymentAdapter {
  return {
    providerCode: 'daimo',

    async sendPayout(_request: PayoutRequest): Promise<PayoutResult> {
      // Fail LOUDLY rather than returning a fabricated success. A payout adapter
      // that reports ACCEPTED without sending anything would be the single most
      // dangerous failure mode in this codebase: the ledger would record a
      // payout that never happened.
      throw new Error(
        DAIMO_API_KEY
          ? `${NOT_INTEGRATED} (credentials are present but no request implementation exists)`
          : NOT_INTEGRATED,
      );
    },

    async getPayoutStatus(_providerReference: string): Promise<{
      status: string;
      raw: Record<string, unknown>;
    }> {
      throw new Error(NOT_INTEGRATED);
    },
  };
}
