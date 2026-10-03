import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import { COMMENT_BODY_MAX } from '@/lib/reviews/contract';

// /api/reviews/comments/[commentId]
//
//   PATCH   the author edits their own reply
//   DELETE  the author removes their own reply (soft)
//
// Same authority rule as the review route: `p_user_id` from the verified session,
// the SQL command scoping by both ids, and another author's comment reported as
// unknown rather than forbidden.

const updateSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply.').max(COMMENT_BODY_MAX),
});

export const PATCH = route(async ({ user, params, body, correlationId }) => {
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('update_review_comment', {
    p_user_id: user!.id,
    p_comment_id: params.commentId,
    p_body: parsed.data.body,
  });

  if (error) {
    const message = String(error.message ?? '');

    if (error.code === 'P0002') {
      throw new RouteError('not_found', 'Unknown reply.');
    }

    if (/not yet published/i.test(message)) {
      throw new RouteError(
        'conflict',
        'This reply is already public, so its text cannot be changed in place. You can delete it instead.',
      );
    }

    console.error('[api] update comment failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not save your reply.');
  }

  const comment = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json({
    comment: {
      id: comment?.id as string,
      body: comment?.body as string,
      status: comment?.status as string,
      updatedAt: comment?.updated_at as string,
    },
    message: 'Your reply has been updated. It still has to pass moderation before it appears.',
  });
});

export const DELETE = route(async ({ user, params, correlationId }) => {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('delete_review_comment', {
    p_user_id: user!.id,
    p_comment_id: params.commentId,
  });

  if (error) {
    if (error.code === 'P0002') {
      throw new RouteError('not_found', 'Unknown reply.');
    }

    console.error('[api] delete comment failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not remove your reply.');
  }

  const comment = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json({
    comment: {
      id: comment?.id as string,
      deletedAt: comment?.deleted_at as string,
    },
    message: 'Your reply has been removed from public view.',
  });
});
