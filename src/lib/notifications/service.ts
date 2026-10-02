import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { describeError, errorFields, isMissingSchemaError } from '@/lib/observability/errors';

// Notification service.
//
// Two rules govern everything here:
//
//  1. A notification is a FACTUAL SYSTEM EVENT, never a support reply and never
//     generated text. The functions that create them take fixed wording, and no
//     caller can pass through arbitrary conversational content.
//
//  2. Notification delivery is NOT the source of truth (doc 45 RELIABILITY). The
//     authoritative record is the underlying domain event, which every
//     notification references by type and id. A dropped or duplicated
//     notification never changes financial state.

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const admin = createAdminClient();

  // Routed through a `public` SECURITY DEFINER wrapper, NOT `admin.from(...)`.
  //
  // The `app` schema is deliberately not exposed through the Data API, so a
  // PostgREST `.select()` cannot see `app.notifications` at all. Reads of app
  // tables must go through these named wrappers (migration 030).
  const { data, error } = await admin.rpc('get_unread_notification_count', {
    p_user_id: userId,
  });

  if (error) {
    // A missing badge count must never fail the page that requested it. The log
    // line carries the full diagnosable shape, because `error.message` alone
    // produced an empty object for exactly the failures that mattered.
    console.error(
      '[notifications] unread count failed',
      isMissingSchemaError(error)
        ? errorFields(error, {
            cause:
              'the read failed at the database layer. If public.get_unread_notification_count ' +
              'does not exist, migration 030 has not been applied.',
          })
        : errorFields(error),
    );

    return 0;
  }

  return typeof data === 'number' ? data : 0;
}

/**
 * The caller's notifications, newest first.
 *
 * Routed through `public.list_my_notifications`, not `.from('notifications')`.
 *
 * The `unreadOnly` filter is applied in the database BEFORE the limit. Filtering
 * afterwards would return "the newest N notifications, some of which are read",
 * which is not what an unread badge is asking for.
 */
export async function listMyNotifications(userId: string, limit = 50, unreadOnly = false) {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('list_my_notifications', {
    p_user_id: userId,
    p_limit: limit,
    p_unread_only: unreadOnly,
  });

  if (error) {
    throw new Error(`notifications: unable to read (${describeError(error)})`);
  }

  return (data ?? []) as Array<{
    id: string;
    category: string;
    title: string;
    body: string;
    actionPath: string | null;
    actionLabel: string | null;
    sourceEventType: string | null;
    sourceId: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
}

/**
 * Creates a factual notification. Idempotent, so a retried job produces one
 * record rather than a stream of them.
 *
 * Idempotency keys are derived from the SOURCE EVENT, never from a timestamp or
 * a random value. Two workers processing the same domain event therefore
 * converge on a single notification.
 */
export async function notifyStateChange(input: {
  userId: string;
  category: string;
  title: string;
  body: string;
  sourceEventType: string;
  sourceId: string;
  actionPath?: string | null;
  actionLabel?: string | null;
  /** Distinguishes repeated distinct events of the same type. */
  discriminator?: string;
}): Promise<void> {
  const admin = createAdminClient();

  const key = [
    'notification',
    input.sourceEventType,
    input.sourceId,
    input.discriminator ?? 'default',
  ].join(':');

  const { error } = await admin.rpc('create_notification', {
    p_user_id: input.userId,
    p_category: input.category,
    p_title: input.title,
    p_body: input.body,
    p_idempotency_key: key,
    p_action_path: input.actionPath ?? null,
    p_action_label: input.actionLabel ?? null,
    p_source_event_type: input.sourceEventType,
    p_source_id: input.sourceId,
  });

  if (error) {
    // Non-fatal by design: the domain event already succeeded, and the
    // authoritative state does not depend on this notification existing.
    console.error('[notifications] create failed', errorFields(error, { key }));
  }
}
