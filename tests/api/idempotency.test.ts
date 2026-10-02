import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';

// deriveIdempotencyKey namespaces every key by the acting user and the action
// scope. This is what stops one user's retry, or a replayed request, from
// colliding with another user's financial operation.

describe('deriveIdempotencyKey', () => {
  it('is deterministic for the same actor and payload', () => {
    const first = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'withdrawal.create',
      payload: { grossMinor: '1000' },
    });
    const second = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'withdrawal.create',
      payload: { grossMinor: '1000' },
    });

    expect(first).toBe(second);
  });

  it('separates two actors using the same payload', () => {
    const a = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      payload: { amountMinor: '5000' },
    });
    const b = deriveIdempotencyKey({
      actorId: 'user-b',
      scope: 'deposit.create',
      payload: { amountMinor: '5000' },
    });

    expect(a).not.toBe(b);
  });

  it('separates different scopes for the same actor and payload', () => {
    const reserve = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'withdrawal.create',
      payload: { amountMinor: '1000' },
    });
    const confirm = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.confirm',
      payload: { amountMinor: '1000' },
    });

    expect(reserve).not.toBe(confirm);
  });

  it('separates different payloads for the same actor', () => {
    const first = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'withdrawal.create',
      payload: { grossMinor: '1000' },
    });
    const second = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'withdrawal.create',
      payload: { grossMinor: '2000' },
    });

    expect(first).not.toBe(second);
  });

  it('reuses a client-supplied key so a genuine retry deduplicates', () => {
    const a = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: 'retry-token-123',
    });
    const b = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: 'retry-token-123',
    });

    expect(a).toBe(b);
    expect(a).toContain('retry-token-123');
  });

  it("still namespaces a supplied key, so one user cannot reuse another user's", () => {
    const a = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: 'shared-token',
    });
    const b = deriveIdempotencyKey({
      actorId: 'user-b',
      scope: 'deposit.create',
      provided: 'shared-token',
    });

    expect(a).not.toBe(b);
  });

  it('trims a supplied key so stray whitespace cannot create a second entry', () => {
    const a = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: '  token  ',
    });
    const b = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: 'token',
    });

    expect(a).toBe(b);
  });

  it('falls back to a payload digest for a blank supplied key', () => {
    const blank = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      provided: '   ',
      payload: { amountMinor: '1000' },
    });
    const none = deriveIdempotencyKey({
      actorId: 'user-a',
      scope: 'deposit.create',
      payload: { amountMinor: '1000' },
    });

    expect(blank).toBe(none);
  });
});
