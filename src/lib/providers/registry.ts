import 'server-only';
import { createReferenceAdapter } from '@/lib/providers/adapters/reference';
import { createCpxCaptureAdapter } from '@/lib/providers/adapters/cpx-capture';
import type { ProviderAdapter } from '@/lib/providers/types';

// Adapter registry (law 12: provider integrations are replaceable).
//
// This map IS the integration surface. Adding a vendor means writing one adapter
// file and adding one line here. No consumer of the reward engine, the ledger or
// the callback path changes, which is exactly what "replaceable" has to mean.
//
// Registration is deliberately explicit rather than dynamic. A dynamic
// auto-discovery scheme would make it possible for code to appear in the
// production bundle without appearing in review, which is the wrong property for
// a component that decides whether a callback is authentic.

const adapters = new Map<string, ProviderAdapter>();

/**
 * Registers an adapter for a provider code. Called once per process at module
 * load. Re-registering the same code is a no-op rather than a silent override,
 * because two adapters claiming one provider code would be a routing ambiguity.
 */
export function registerAdapter(providerCode: string, adapter: ProviderAdapter): void {
  const key = providerCode.trim().toLowerCase();

  if (adapters.has(key)) {
    return;
  }

  adapters.set(key, adapter);
}

export function getAdapter(providerCode: string): ProviderAdapter | null {
  return adapters.get(providerCode.trim().toLowerCase()) ?? null;
}

export function hasAdapter(providerCode: string): boolean {
  return adapters.has(providerCode.trim().toLowerCase());
}

export function listRegisteredProviders(): string[] {
  return [...adapters.keys()].sort();
}

/**
 * Registers the reference adapter.
 *
 * It is bound to PROVIDER_CALLBACK_SECRET. When that variable is unset the
 * adapter still registers but every callback verifies as UNSUPPORTED, which is
 * the correct fail-closed behaviour: an unconfigured provider must not accept
 * traffic that appears authentic.
 *
 * The reference provider code is deliberately not one of the real vendor codes
 * seeded in migration 014. Seeding a real vendor with a reference signature
 * scheme would misrepresent that vendor as integrated.
 */
function registerBuiltInAdapters(): void {
  const secret = process.env.PROVIDER_CALLBACK_SECRET ?? null;

  registerAdapter('reference', createReferenceAdapter(secret));

  // CPX Research is registered as a CAPTURE adapter, NOT an integration.
  //
  // It authenticates nothing, so it can never produce a conversion or a reward. It
  // exists because `ingestProviderCallback` returns 'no adapter is registered' before
  // it records evidence - so without SOME adapter, a real CPX postback leaves
  // `app.provider_callbacks` empty and there is no payload to read.
  //
  // `cpx_research` is a real seeded provider code (migration 014), so registering the
  // capture adapter under it is not the misrepresentation the comment below warns
  // about: the seeded row stays `CANDIDATE`, and this adapter's `verification_result`
  // is permanently `UNSUPPORTED`. It is replaced by a real adapter, and removed, once
  // CPX's actual postback format has been observed.
  registerAdapter('cpx_research', createCpxCaptureAdapter());
}

registerBuiltInAdapters();
