import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUnreadNotificationCount, listMyNotifications } from '@/lib/notifications/service';

// GET /api/notifications
//
// The in-app notification centre (doc 45). First-party and database-backed; no
// paid notification provider is involved at any point (law 61).

export const GET = route(async ({ user, searchParams }) => {
  const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);
  const unreadOnly = searchParams.get('unread') === 'true';

  // Routed through `public.list_my_notifications`, NOT `.from('notifications')`.
  // The `app` schema is not exposed through the Data API, and the wrapper scopes
  // the read to `p_user_id` in the database.
  const [notifications, unreadCount] = await Promise.all([
    listMyNotifications(user!.id, limit, unreadOnly),
    getUnreadNotificationCount(user!.id),
  ]);

  return NextResponse.json({
    notifications: notifications.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      actionPath: row.actionPath,
      actionLabel: row.actionLabel,
      // Notification delivery is never the source of truth, so the underlying
      // authoritative event reference travels with it.
      sourceEventType: row.sourceEventType,
      sourceId: row.sourceId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    unreadCount,
  });
});
