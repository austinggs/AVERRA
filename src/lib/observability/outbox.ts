import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, redact } from '@/lib/observability/logger';
import { handlers, type OutboxEvent } from '@/lib/observability/handlers';
import { errorFields } from '@/lib/observability/errors';

// Transactional outbox processor (doc 50 RESILIENCE, ADR-0001).
//
// Financial commands write to app.outbox_events INSIDE the same transaction as
// the state change, so an event can never be lost. This module is the consumer.
//
// Three properties matter, and each is a law rather than a preference:
//
//  * IDEMPOTENT. Re-running a handler must not double-notify or double-credit.
//    Handlers are keyed on the source event.
//  * BOUNDED RETRIES. A failing handler retries a limited number of times, then
//    becomes DEAD and visible. It never retries forever.
//  * FINANCIAL STATE IS INDEPENDENT. A handler failure does NOT roll back the
//    ledger entry that produced the event. The money already moved; a downstream
//    notification catching up is a separate concern.

export type HandlerResult = {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
};

const MAX_ATTEMPTS = 5;

/**
 * Drains a batch of the outbox queue.
 *
 * Safe to call concurrently from several workers: the claim uses SKIP LOCKED, so
 * no event is delivered twice. Safe to call repeatedly: completed events are not
 * reclaimed.
 */
export async function processOutboxBatch(
  limit = 25,
  workerId = `worker-${randomUUID().slice(0, 8)}`,
): Promise<HandlerResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('claim_outbox_events', {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 60,
  });

  if (error) {
    logger.error('outbox.claim_failed', errorFields(error, { workerId }));
    return { claimed: 0, processed: 0, failed: 0, dead: 0 };
  }

  const events = (data ?? []) as OutboxEvent[];

  const result: HandlerResult = { claimed: events.length, processed: 0, failed: 0, dead: 0 };

  for (const event of events) {
    const handler = handlers[event.event_type];

    if (!handler) {
      // An unknown event type is not worth retrying. Marking it DEAD keeps it
      // visible to an operator without consuming a slot on every future pass.
      const { data: status } = await admin.rpc('fail_outbox_event', {
        p_event_id: event.id,
        p_error: `no handler registered for event type: ${event.event_type}`,
        p_max_attempts: 1,
      });

      result.dead += 1;
      logger.warn('outbox.no_handler', {
        eventId: event.id,
        eventType: event.event_type,
        status,
      });
      continue;
    }

    try {
      await handler(event);

      await admin.rpc('complete_outbox_event', { p_event_id: event.id });
      result.processed += 1;
    } catch (handlerError) {
      const message = handlerError instanceof Error ? handlerError.message : String(handlerError);

      const { data: status } = await admin.rpc('fail_outbox_event', {
        p_event_id: event.id,
        p_error: message,
        p_max_attempts: MAX_ATTEMPTS,
      });

      result.failed += 1;
      if (status === 'DEAD') result.dead += 1;

      // An unhandled handler failure is a real operational signal, not noise.
      logger.error('outbox.handler_failed', {
        eventId: event.id,
        eventType: event.event_type,
        attempts: event.attempts,
        status,
        error: message,
        payload: redact(event.payload),
      });
    }
  }

  if (events.length > 0) {
    logger.info('outbox.batch_processed', { workerId, ...result });
  }

  return result;
}

/** Queue depth for dashboards and alerting (doc 62). */
export async function getOutboxBacklog(): Promise<Record<string, number>> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('outbox_backlog');

  if (error) {
    logger.error('outbox.backlog_failed', errorFields(error));
    return {};
  }

  const backlog: Record<string, number> = {};

  for (const row of (data ?? []) as Array<{ status: string; event_count: number | string }>) {
    backlog[row.status] = Number(row.event_count);
  }

  return backlog;
}
