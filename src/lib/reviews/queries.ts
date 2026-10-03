import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// Server-side reads for the Reviews UI (doc 86).
//
// Routed through the `public` wrappers, never `.from(...)`: the `app` schema is
// deliberately not exposed through the Data API, so a PostgREST read of these
// tables fails with PGRST205 regardless of RLS. See AGENTS.md.
//
// Every function here degrades to an empty result rather than throwing. A public
// surface that 500s on a database hiccup is worse than one that reads "no reviews
// yet", and the real failure is logged server-side and never shown as content.

export type ReviewMediaItem = {
  id: string;
  storagePath: string;
  mimeType: string;
};

export type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  category: string | null;
  publishedAt: string;
  verificationType: string;
  verifiedExperienceType: string | null;
  authorDisplayName: string | null;
  media: ReviewMediaItem[];
};

export type ReviewSummary = {
  totalReviews: number;
  verifiedReviews: number;
  averageRating: number | null;
  distribution: Record<string, number>;
};

export type PublicReviewsPage = {
  reviews: PublicReview[];
  summary: ReviewSummary;
  count: number;
  limit: number;
  offset: number;
};

const EMPTY_SUMMARY: ReviewSummary = {
  totalReviews: 0,
  verifiedReviews: 0,
  averageRating: null,
  distribution: {},
};

function mapMedia(value: unknown): ReviewMediaItem[] {
  return ((value ?? []) as Array<Record<string, unknown>>).map((m) => ({
    id: m.id as string,
    storagePath: m.storagePath as string,
    mimeType: m.mimeType as string,
  }));
}

/**
 * The public review list.
 *
 * The page and the summary are fetched together so the rating shown above the list
 * is computed over the same PUBLISHED population the list is drawn from (doc 86
 * RATINGS). Reading them separately is how a rating ends up describing a different
 * set than the reviews beneath it.
 */
export async function getPublicReviews(options?: {
  limit?: number;
  offset?: number;
  category?: string | null;
  minRating?: number | null;
}): Promise<PublicReviewsPage> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const offset = Math.max(options?.offset ?? 0, 0);

  const admin = createAdminClient();

  const [listResult, summaryResult] = await Promise.all([
    admin.rpc('list_public_reviews', {
      p_limit: limit,
      p_offset: offset,
      p_category: options?.category ?? null,
      p_min_rating: options?.minRating ?? null,
    }),
    admin.rpc('get_review_summary'),
  ]);

  if (listResult.error) {
    console.error('[reviews] public list failed', errorFields(listResult.error));
    return { reviews: [], summary: EMPTY_SUMMARY, count: 0, limit, offset };
  }

  const rows = (listResult.data ?? []) as Array<Record<string, unknown>>;
  const summary = (summaryResult.data ?? {}) as Record<string, unknown>;

  // `averageRating` is `round(avg(...), 2)`, so PostgreSQL returns numeric as a
  // string. Coerced here so the UI never renders a string-typed average, and so an
  // empty table yields null rather than NaN.
  const rawAverage = summary.averageRating;
  const average = rawAverage === null || rawAverage === undefined ? null : Number(rawAverage);

  return {
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
      media: mapMedia(row.media),
    })),
    summary: {
      totalReviews: (summary.totalReviews as number | null) ?? 0,
      verifiedReviews: (summary.verifiedReviews as number | null) ?? 0,
      averageRating: Number.isFinite(average) ? average : null,
      distribution: (summary.distribution ?? {}) as Record<string, number>,
    },
    count: rows.length,
    limit,
    offset,
  };
}

export type ReviewComment = {
  id: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
  authorDisplayName: string | null;
  media: ReviewMediaItem[];
};

/** The threaded conversation for one review. */
export async function getReviewComments(reviewId: string): Promise<ReviewComment[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('list_review_comments', {
    p_review_id: reviewId,
    p_limit: 50,
  });

  if (error) {
    console.error('[reviews] comment list failed', errorFields(error));
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    parentCommentId: row.parentCommentId as string | null,
    body: row.body as string,
    createdAt: row.createdAt as string,
    authorDisplayName: row.authorDisplayName as string | null,
    media: mapMedia(row.media),
  }));
}

export type MyReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  category: string | null;
  status: string;
  verificationType: string;
  verifiedExperienceType: string | null;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  mediaCount: number;
};

/**
 * The caller's own reviews, in any state.
 *
 * The author is told the real state: a hidden review is still their content, and
 * silently vanishing would be worse than an honest label (doc 09 TRANSPARENCY).
 */
export async function getMyReviews(userId: string): Promise<MyReview[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('list_my_reviews', {
    p_user_id: userId,
    p_limit: 25,
  });

  if (error) {
    console.error('[reviews] my reviews failed', errorFields(error));
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    rating: row.rating as number,
    title: row.title as string | null,
    body: row.body as string,
    category: row.category as string | null,
    status: row.status as string,
    verificationType: row.verificationType as string,
    verifiedExperienceType: row.verifiedExperienceType as string | null,
    createdAt: row.createdAt as string,
    publishedAt: row.publishedAt as string | null,
    deletedAt: row.deletedAt as string | null,
    mediaCount: (row.mediaCount as number | null) ?? 0,
  }));
}
