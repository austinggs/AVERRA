import 'server-only';
import { createDaimoAdapter } from './adapters/daimo';
import type {
  AdapterAvailability,
  PaymentAdapter,
  PaymentMethod,
  PayoutRequest,
  PayoutResult,
} from './types';
import { executionModeFor, isAutomaticMethod } from './types';

// Payment adapter registry.
//
// Mirrors the provider adapter registry (law 12) for the payment side.
//
// LAW 40 IS ENFORCED HERE, NOT JUST DOCUMENTED.
//
// `getAdapter` returns null for an unconfigured automatic method, and the
// CALLER must then keep the operation MANUAL_OPERATOR or fail it visibly. There
// is deliberately no helper that "helpfully" returns a manual handler for an
// automatic method, because that helper would be exactly the silent fallback
// law 40 forbids.
//
// Registration is explicit rather than dynamic, for the same reason as the
// provider registry: code that moves money must appear in review.

const adapters = new Map<string, PaymentAdapter>();

/**
 * Which vendor serves which automatic method.
 *
 * Doc 38 names exactly one automatic outbound method today:
 * CRYPTO_AUTOMATIC_DAIMO. The mapping is explicit rather than inferred from a
 * string, so adding a second automatic rail is a deliberate edit to this table
 * and not a side effect of naming an adapter.
 *
 * MANUAL methods are deliberately absent. There is no vendor behind them, and
 * their absence here is what makes a manual fallback impossible.
 */
const ADAPTER_FOR_METHOD: Partial<Record<PaymentMethod, string>> = {
  CRYPTO_AUTOMATIC_DAIMO: 'daimo',
};

function adapterFor(method: PaymentMethod): PaymentAdapter | null {
  const code = ADAPTER_FOR_METHOD[method];
  return code ? (adapters.get(code) ?? null) : null;
}

export function registerPaymentAdapter(adapter: PaymentAdapter): void {
  const key = adapter.providerCode.trim().toLowerCase();

  // Re-registration is a no-op rather than a silent override: two adapters
  // claiming one provider code would be a routing ambiguity over real money.
  if (adapters.has(key)) return;

  adapters.set(key, adapter);
}

export function getPaymentAdapter(providerCode: string): PaymentAdapter | null {
  return adapters.get(providerCode.trim().toLowerCase()) ?? null;
}

export function listRegisteredPaymentAdapters(): string[] {
  return [...adapters.keys()].sort();
}

/**
 * Whether a method can be executed automatically right now.
 *
 * A method is available automatically only when BOTH hold:
 *   - it is an automatic method at all (doc 38)
 *   - an adapter is registered for it
 *   - that adapter is INTEGRATED, not merely present
 *
 * The third condition is why registration alone is not enough. The Daimo adapter
 * is registered so the routing seam is exercised, but it refuses every call, so
 * reporting it "available" would be a lie the UI could act on.
 *
 * A manual method is never "available automatically", and an automatic method
 * with no working adapter is not silently downgraded. It returns unavailable, and
 * the operator workflow decides what happens next.
 */
export function availabilityFor(method: PaymentMethod): AdapterAvailability {
  if (!isAutomaticMethod(method)) {
    return {
      available: false,
      reason: `${method} is a manual method and is executed by a named human operator`,
    };
  }

  if (!adapterFor(method)) {
    return {
      available: false,
      reason:
        'no payout adapter is registered for this method; the operation stays pending ' +
        'for an operator and must not be rerouted to a manual rail',
    };
  }

  return {
    available: false,
    reason:
      'the automatic payout adapter for this method is registered but not integrated. ' +
      'The operation must stay pending for an operator and must not be rerouted (law 40)',
  };
}

/**
 * Sends a payout through the adapter for its method.
 *
 * Throws for a manual method. This is intentional: a caller reaching for this
 * function with a manual method has a bug, and law 22 means a manual payout is
 * performed by a person through an operator workflow, not by code.
 */
export async function sendPayoutViaAdapter(
  method: PaymentMethod,
  request: PayoutRequest,
): Promise<PayoutResult> {
  if (executionModeFor(method) !== 'AUTOMATIC_ADAPTER') {
    throw new Error(
      `sendPayoutViaAdapter: ${method} is a MANUAL_OPERATOR method and must not be executed by an adapter (law 22, law 40)`,
    );
  }

  const adapter = adapterFor(method);

  if (!adapter) {
    throw new Error(
      `sendPayoutViaAdapter: no adapter is registered for ${method}. ` +
        'The operation must remain pending for an operator. It must NOT be retried as a manual payout (law 40).',
    );
  }

  return adapter.sendPayout(request);
}

/**
 * Registers the built-in payment adapters.
 *
 * The Daimo adapter registers even though it cannot send. That is intentional:
 * the registry is the integration seam, and having it wired proves the routing
 * works before any credential exists. `availabilityFor` reports the honest
 * answer regardless.
 */
function registerBuiltInPaymentAdapters(): void {
  registerPaymentAdapter(createDaimoAdapter());
}

registerBuiltInPaymentAdapters();
