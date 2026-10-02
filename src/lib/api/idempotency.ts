import { createHash } from 'node:crypto';

// Idempotency keys for financial mutations (doc 49 CONVENTIONS).
//
// Deliberately NOT in route.ts: this logic is pure and worth unit-testing, and
// importing route.ts into a test would trip the `server-only` guard that stops
// client components reaching privileged code.

/**
 * Derives a stable idempotency key for a mutation.
 *
 * The key is ALWAYS namespaced by the acting user and the action scope. Two
 * consequences follow, and both matter:
 *
 *  - A genuine network retry deduplicates, because a client-supplied token is
 *    reused verbatim within the actor's own namespace.
 *  - One user can never collide with another user's operation, even by sending
 *    an identical token, so a replayed request cannot cancel, confirm or reserve
 *    somebody else's money.
 */
export function deriveIdempotencyKey(input: {
  actorId: string;
  scope: string;
  provided?: string | null;
  payload?: unknown;
}): string {
  if (input.provided && input.provided.trim().length > 0) {
    return `${input.scope}:${input.actorId}:${input.provided.trim()}`;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(input.payload ?? {}))
    .digest('hex')
    .slice(0, 32);

  return `${input.scope}:${input.actorId}:${digest}`;
}
