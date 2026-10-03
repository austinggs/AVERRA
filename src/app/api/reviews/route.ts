import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { errorFields } from '@/lib/observability/errors';
import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_BODY_MAX,
  REVIEW_EXPERIENCE_TYPES,
  REVIEW_TITLE_MAX,
} from '@/lib/reviews/contract';

// POST /api/reviews
//
// Submits a review (doc 86).
//
// WHAT THIS ROUTE CANNOT DO
//
// It cannot publish anything. `submit_review` writes PENDING and the database
// decides publication through a human moderator, so a 201 here means "recorded",
// never "visible" (law 67). It also cannot move money: a review has no financial
// column and no path to one (law 63), and the Verified Experience badge is granted
// by the database, never by the client.

const submitSchema = z.object({
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX),
  body: z.string().trim().min(1, 'Write your review.').max(REVIEW_BODY_MAX),
  title: z.string().trim().min(1).max(REVIEW_TITLE_MAX).optional(),
  category: z.string().trim().max(60).optional(),
  // Law 64: the client may CLAIM which platform activity backs the badge, but the
  // database re-checks that the event exists AND belongs to the author. A claim
  // that does not verify is refused, not downgraded to UNVERIFIED.
  verifiedExperienceType: z.enum(REVIEW_EXPERIENCE_TYPES).optional(),
  verifiedExperienceId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = submitSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const input = parsed.data;

  // The badge requires BOTH halves. Accepting one without the other would name a
  // type with no evidence, or carry evidence with no claim; the database
  // constraint `reviews_verification_evidence_consistent` rejects both anyway, so
  // this rejects them earlier and with a usable message.
  if (Boolean(input.verifiedExperienceType) !== Boolean(input.verifiedExperienceId)) {
    throw new RouteError(
      'validation_failed',
      'A verified activity needs both a type and the reference to it.',
    );
  }

  const idempotencyKey = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'review.submit',
    provided: input.idempotencyKey,
    payload: {
      rating: input.rating,
      body: input.body,
      title: input.title ?? null,
      category: input.category ?? null,
      verifiedExperienceType: input.verifiedExperienceType ?? null,
      verifiedExperienceId: input.verifiedExperienceId ?? null,
    },
  });

  const admin = createAdminClient();

  // Routed through `public.submit_review`, NOT `.from('reviews')`. The `app` schema
  // is not exposed through the Data API. p_user_id comes from the verified session
  // claim, never from the request body.
  const { data, error } = await admin.rpc('submit_review', {
    p_user_id: user!.id,
    p_rating: input.rating,
    p_body: input.body,
    p_title: input.title ?? null,
    p_category: input.category ?? null,
    p_verified_experience_type: input.verifiedExperienceType ?? null,
    p_verified_experience_id: input.verifiedExperienceId ?? null,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: correlationId,
  });

  if (error) {
    // The database is the authority on law 64, so a rejected verification claim is
    // a validation outcome, not a crash, and must not be reported as a 500.
    const code = error.code as string | undefined;
    const message = String(error.message ?? '');

    if (code === '42501') {
      throw new RouteError('forbidden', message || 'That activity cannot back this review.');
    }

    if (code === '23505' || /duplicate key|already/i.test(message)) {
      throw new RouteError('conflict', 'That review has already been recorded.');
    }

    if (code === '23514' || code === '22023' || code === '22P02') {
      throw new RouteError('validation_failed', 'That review could not be accepted as written.');
    }

    console.error('[api] submit review failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not record your review.');
  }

  const review = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json(
    {
      review: {
        id: review?.id as string,
        rating: review?.rating as number,
        status: review?.status as string,
        verificationType: review?.verification_type as string,
        verifiedExperienceType: review?.verified_experience_type as string | null,
        createdAt: review?.created_at as string,
      },
      message:
        'Thank you. Your review has been recorded and is waiting for a human moderator ' +
        'to check it before it appears publicly. This is a claim about your own ' +
        'experience - it is not an endorsement and it does not affect your balance.',
    },
    { status: 201 },
  );
});

// GET /api/reviews
//
// Public. No authentication, and deliberately so: doc 86 requires public reviews
// to be readable, and an unauthenticated read of PUBLISHED rows leaks nothing -
// `list_public_reviews` returns published, undeleted rows only, and withholds
// `verified_experience_id` because it points at private financial or support
// evidence (law 69).
export const GET = route(
  async ({ searchParams }) => {
    const limitParam = Number(searchParams.get('limit') ?? 20);
    const offsetParam = Number(searchParams.get('offset') ?? 0);
    const minRatingParam = searchParams.get('minRating');
    const category = searchParams.get('category');

    // Unparseable input falls back to the default rather than reaching the
    // database as NaN, which PostgREST would reject with an opaque 400.
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    let minRating: number | null = null;
    if (minRatingParam !== null) {
      const parsed = Number(minRatingParam);
      if (!Number.isFinite(parsed) || parsed < RATING_MIN || parsed > RATING_MAX) {
        throw new RouteError(
          'validation_failed',
          `minRating must be between ${RATING_MIN} and ${RATING_MAX}.`,
        );
      }
      minRating = Math.trunc(parsed);
    }

    const admin = createAdminClient();

    // The page and the summary come from one round trip, so the rating shown above
    // the list is computed over the same PUBLISHED population the list is drawn
    // from (doc 86 RATINGS). Reading them separately is how a rating ends up
    // describing a different set than the reviews beneath it.
    const [listResult, summaryResult] = await Promise.all([
      admin.rpc('list_public_reviews', {
        p_limit: limit,
        p_offset: offset,
        p_category: category,
        p_min_rating: minRating,
      }),
      admin.rpc('get_review_summary'),
    ]);

    if (listResult.error) {
      console.error('[api] list reviews failed', errorFields(listResult.error));
      throw new RouteError('internal_error', 'Could not load reviews.');
    }

    const rows = (listResult.data ?? []) as Array<Record<string, unknown>>;
    const summary = (summaryResult.data ?? {}) as Record<string, unknown>;

    const media = (value: unknown) =>
      ((value ?? []) as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        // A storage path is not a public URL. It is only resolvable through a
        // Storage bucket that does not exist yet, so the client receives the
        // object id and renders a placeholder rather than a broken image.
        storagePath: m.storagePath as string,
        mimeType: m.mimeType as string,
        width: (m.width as number | null) ?? null,
        height: (m.height as number | null) ?? null,
      }));

    return NextResponse.json({
      reviews: rows.map((row) => ({
        id: row.id as string,
        rating: row.rating as number,
        title: row.title as string | null,
        body: row.body as string,
        category: row.category as string | null,
        publishedAt: row.publishedAt as string,
        verificationType: row.verificationType as string,
        verifiedExperienceType: row.verifiedExperienceType as string | null,
        authorDisplayName: row.authorDisplayName as string | null,
        media: media(row.media),
      })),
      summary: {
        totalReviews: (summary.totalReviews as number | null) ?? 0,
        // Reported separately from the total, because doc 86 requires the UI to
        // distinguish them and forbids presenting an opinion as a verified fact.
        verifiedReviews: (summary.verifiedReviews as number | null) ?? 0,
        averageRating: summary.averageRating as string | number | null,
        distribution: (summary.distribution ?? {}) as Record<string, number>,
      },
      count: rows.length,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);
