import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import { RATING_MAX, RATING_MIN } from '@/lib/reviews/contract';

// /api/reviews/[reviewId]
//
//   PATCH   the author edits their own review
//   DELETE  the author takes down their own review (soft)
//
// WHO MAY ACT: the author, and only the author. `p_user_id` comes from the verified
// session and is never read from the body or the path, and the SQL command scopes
// its lookup by BOTH that id and the record id. Another user's review is therefore
// reported as unknown rather than forbidden, which is what stops this route from
// confirming that an id exists (doc 67 BOLA).
//
// WHY A PUBLISHED REVIEW CANNOT BE EDITED IN PLACE
//
// The command refuses it. Rewriting text that other people have already read and
// replied to is a history rewrite wearing a UI; the honest sequence is to publish,
// and if it was wrong, take it down explicitly and say so.
//
// WHAT DELETE DOES NOT DO: it does not erase. `deleted_at` is set and the row
// stays, because the author must still see that their review existed and a dispute
// may later need the moderation trail (doc 09, doc 67).

const updateSchema = z.object({
  body: z.string().trim().min(1, 'Write your review.').max(5000),
  title: z.string().trim().min(1).max(200).optional(),
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX).optional(),
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

  // Routed through `public.update_review`, NOT `.from('reviews')`. The `app` schema
  // is not exposed through the Data API.
  const { data, error } = await admin.rpc('update_review', {
    p_user_id: user!.id,
    p_review_id: params.reviewId,
    p_body: parsed.data.body,
    p_title: parsed.data.title ?? null,
    p_rating: parsed.data.rating ?? null,
  });

  if (error) {
    const message = String(error.message ?? '');

    if (error.code === 'P0002') {
      throw new RouteError('not_found', 'Unknown review.');
    }

    if (/not yet published/i.test(message)) {
      throw new RouteError(
        'conflict',
        'This review is already public, so its text cannot be changed in place. You can delete it instead.',
      );
    }

    if (error.code === '23514') {
      throw new RouteError('validation_failed', 'That review could not be saved as written.');
    }

    console.error('[api] update review failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not save your review.');
  }

  const review = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json({
    review: {
      id: review?.id as string,
      rating: review?.rating as number,
      title: review?.title as string | null,
      body: review?.body as string,
      status: review?.status as string,
      updatedAt: review?.updated_at as string,
    },
    message: 'Your review has been updated. It still has to pass moderation before it appears.',
  });
});

export const DELETE = route(async ({ user, params, correlationId }) => {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('delete_review', {
    p_user_id: user!.id,
    p_review_id: params.reviewId,
  });

  if (error) {
    if (error.code === 'P0002') {
      throw new RouteError('not_found', 'Unknown review.');
    }

    console.error('[api] delete review failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not remove your review.');
  }

  const review = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json({
    review: {
      id: review?.id as string,
      deletedAt: review?.deleted_at as string,
    },
    message:
      'Your review has been removed from public view. It stays on your record with its ' +
      'history, which we do not erase.',
  });
});
