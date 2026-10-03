import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { errorFields } from '@/lib/observability/errors';
import { COMMENT_BODY_MAX } from '@/lib/reviews/contract';

// /api/reviews/[reviewId]/comments
//
//   GET   the public thread. Unauthenticated, like the review itself.
//   POST  post a reply.
//
// The thread is "a public community conversation, not private messaging"
// (doc 86 THREAD MODEL), so it carries no financial or support content.

const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply.').max(COMMENT_BODY_MAX),
  parentCommentId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export const GET = route(
  async ({ params, searchParams }) => {
    const reviewId = params.reviewId;
    const limitParam = Number(searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const admin = createAdminClient();

    // Routed through `public.list_review_comments`, NOT `.from('review_comments')`.
    // The wrapper returns PUBLISHED comments on a PUBLISHED review only, so a
    // hidden review cannot leak its conversation.
    const { data, error } = await admin.rpc('list_review_comments', {
      p_review_id: reviewId,
      p_limit: limit,
    });

    if (error) {
      throw new RouteError('not_found', 'That conversation could not be found.');
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    return NextResponse.json({
      comments: rows.map((row) => ({
        id: row.id as string,
        parentCommentId: row.parentCommentId as string | null,
        body: row.body as string,
        createdAt: row.createdAt as string,
        authorDisplayName: row.authorDisplayName as string | null,
        media: ((row.media ?? []) as Array<Record<string, unknown>>).map((m) => ({
          id: m.id as string,
          storagePath: m.storagePath as string,
          mimeType: m.mimeType as string,
        })),
      })),
      count: rows.length,
    });
  },
  { requireAuth: false },
);

export const POST = route(async ({ user, params, body, correlationId }) => {
  const parsed = commentSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const input = parsed.data;

  const idempotencyKey = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'review.comment',
    provided: input.idempotencyKey,
    payload: {
      reviewId: params.reviewId,
      body: input.body,
      parentCommentId: input.parentCommentId ?? null,
    },
  });

  const admin = createAdminClient();

  // `submit_review_comment` returns PENDING, like a review does. The composite
  // foreign key `review_comments_parent_same_review` is what stops a crafted
  // parent_comment_id from grafting a reply onto a different review, so this route
  // does not need to resolve the parent itself.
  const { data, error } = await admin.rpc('submit_review_comment', {
    p_user_id: user!.id,
    p_review_id: params.reviewId,
    p_body: input.body,
    p_parent_comment_id: input.parentCommentId ?? null,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: correlationId,
  });

  if (error) {
    const code = error.code as string | undefined;

    // 23503 is the composite FK: the parent belongs to a different review.
    if (code === '23503') {
      throw new RouteError('not_found', 'That reply target is not part of this conversation.');
    }

    if (code === '23505') {
      throw new RouteError('conflict', 'That reply has already been recorded.');
    }

    console.error('[api] submit comment failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not post your reply.');
  }

  const comment = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json(
    {
      comment: {
        id: comment?.id as string,
        body: comment?.body as string,
        status: comment?.status as string,
        parentCommentId: comment?.parent_comment_id as string | null,
        createdAt: comment?.created_at as string,
      },
      message: 'Your reply has been recorded and is waiting for a moderator.',
    },
    { status: 201 },
  );
});
