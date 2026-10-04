// CPX Research CAPTURE adapter.
//
// THIS IS NOT AN INTEGRATION, AND IT CAN NEVER BECOME ONE BY ACCIDENT.
//
// WHY IT EXISTS
//
// `ingestProviderCallback` returns early with 'no adapter is registered' BEFORE it
// records any evidence:
//
//     if (!adapter?.verifyCallback || !adapter.handleCallback) {
//       return { outcome: 'REJECTED', reason: 'no adapter is registered' };
//     }
//
// So with no adapter registered, a CPX postback is rejected and `app.provider_callbacks`
// stays EMPTY. There is no log line, no conversion, and no evidence - a state
// indistinguishable from "the provider has not sent anything yet".
//
// That matters because CPX's postback format and signing scheme are NOT publicly
// documented. Four sources were checked and they disagree: one production
// integration reports `md5(trans_id + secure_hash)` over `user_id/amount_local/
// status/trans_id/hash`, another sample shows no hash at all, and the largest known
// network running CPX documents no postback hash. Writing verification against a
// guess would fail CLOSED, and "closed" here means every real conversion silently
// rejected while the dashboard reads "no earnings yet".
//
// This adapter exists to make the evidence table usable. It records what CPX actually
// sends so the adapter can then be written against ground truth instead of a forum
// post.
//
// WHY IT IS SAFE BY CONSTRUCTION
//
// `verifyCallback` returns `UNSUPPORTED` - unconditionally, for every input. In
// `ingestProviderCallback`, a non-`VERIFIED` result:
//
//   * WRITES the raw evidence (the whole point), and
//   * RETURNS before `handleCallback`, so no conversion is ever normalized, and
//   * therefore no reward is ever created, and
//   * leaves `app.provider_callbacks.verification_result = 'UNSUPPORTED'`, which the
//     `idx_provider_callbacks_unverified` index exists to surface.
//
// So this adapter can capture everything and pay nothing. It is not a stub that could
// be mistaken for a working integration: it has no code path that returns VERIFIED,
// and there is no configuration that would change that.
//
// THE REAL ADAPTER REPLACES THIS FILE ENTIRELY, in a later change, once the observed
// payload has been read. This file is deleted in that change rather than left
// alongside it - two adapters claiming `cpx_research` would be a routing ambiguity,
// which `registerAdapter` refuses and rightly so.

import type { CallbackVerification, ProviderAdapter, RawCallback } from '@/lib/providers/types';

export function createCpxCaptureAdapter(): ProviderAdapter {
  return {
    verifyCallback: async (_input: RawCallback): Promise<CallbackVerification> => {
      // Not a TODO marker dressed as an implementation. This is the intended,
      // permanent behaviour of the CAPTURE adapter: refuse to authenticate anything,
      // while the pipeline above still persists the payload for inspection.
      return {
        result: 'UNSUPPORTED',
        reason:
          'cpx capture adapter: the CPX postback signature scheme is unverified, so no ' +
          'callback is authenticated and no conversion or reward can be produced',
      };
    },
  };
}
