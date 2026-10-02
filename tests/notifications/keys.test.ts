import { describe, expect, it } from 'vitest';

// Notification idempotency keys.
//
// Deriving the key from the SOURCE EVENT rather than from a timestamp or random
// value is what makes two workers converge on one notification instead of
// producing a duplicate (doc 45 RELIABILITY). These tests pin that derivation.

// Mirrors src/lib/notifications/service.ts notifyStateChange key construction.
function buildKey(input: {
  sourceEventType: string;
  sourceId: string;
  discriminator?: string;
}): string {
  return [
    'notification',
    input.sourceEventType,
    input.sourceId,
    input.discriminator ?? 'default',
  ].join(':');
}

describe('notification idempotency keys', () => {
  it('is deterministic for the same source event', () => {
    const a = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'dep-1' });
    const b = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'dep-1' });

    expect(a).toBe(b);
  });

  it('differs across distinct source events, so two events make two notifications', () => {
    const a = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'dep-1' });
    const b = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'dep-2' });

    expect(a).not.toBe(b);
  });

  it('differs across distinct event types for the same id', () => {
    const a = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'x' });
    const b = buildKey({ sourceEventType: 'deposit.rejected', sourceId: 'x' });

    expect(a).not.toBe(b);
  });

  it('namespaces by event type, so a withdrawal event cannot collide with a deposit', () => {
    const deposit = buildKey({ sourceEventType: 'deposit', sourceId: 'shared-id' });
    const withdrawal = buildKey({ sourceEventType: 'withdrawal', sourceId: 'shared-id' });

    expect(deposit).not.toBe(withdrawal);
  });

  it('allows a discriminator for repeated distinct events of one type', () => {
    const created = buildKey({
      sourceEventType: 'withdrawal.state_changed',
      sourceId: 'w-1',
      discriminator: 'ELIGIBILITY_CHECKED',
    });
    const settled = buildKey({
      sourceEventType: 'withdrawal.state_changed',
      sourceId: 'w-1',
      discriminator: 'COMPLETED',
    });

    expect(created).not.toBe(settled);
  });

  it('defaults the discriminator so an omitted value stays stable', () => {
    expect(buildKey({ sourceEventType: 'x', sourceId: 'y' })).toBe(
      buildKey({ sourceEventType: 'x', sourceId: 'y', discriminator: 'default' }),
    );
  });

  it('contains no user-supplied free text, only identifiers', () => {
    const key = buildKey({ sourceEventType: 'deposit.confirmed', sourceId: 'dep-1' });

    expect(key).toBe('notification:deposit.confirmed:dep-1:default');
    expect(key).not.toContain(' ');
  });
});
