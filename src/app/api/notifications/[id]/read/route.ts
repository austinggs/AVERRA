import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/notifications/:id/read
//
// Marks one notification read. Ownership is enforced inside the database
// function by matching user_id, so this route cannot mark another user's
// notification read even if the id were guessed correctly.

const bodySchema = z.object({}).passthrough();

export const POST = route(async ({ user, body, params }) => {
  const notificationId = params.id;

  if (!notificationId) {
    throw new RouteError('invalid_request', 'Unknown notification.');
  }

  bodySchema.safeParse(body ?? {});

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('mark_notification_read', {
    p_notification_id: notificationId,
    p_user_id: user!.id,
  });

  if (error) {
    // A missing notification and someone else's notification produce the same
    // message, so this cannot be used to probe for valid ids.
    throw new RouteError('not_found', 'Unknown notification.');
  }

  const notification = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    notification: {
      id: notification?.id ?? notificationId,
      readAt: notification?.read_at ?? new Date().toISOString(),
    },
  });
});
