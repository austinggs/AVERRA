import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/reviews/mine
//
// The caller's OWN reviews, in any state.
//
// Scoped by p_user_id taken from the verified session, never the request body.
// The author is told the real state - a hidden review is still their content, and
// silently vanishing is worse than an honest label (doc 09 TRANSPARENCY applied to
// content).

export const GET = route(async ({ user, searchParams }) => {
  const limitParam = Number(searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;

  const admin = createAdminClient();

  // Routed through `public.list_my_reviews`, NOT `.from('reviews')`. The `app`
  // schema is not exposed through the Data API.
  const { data, error } = await admin.rpc('list_my_reviews', {
    p_user_id: user!.id,
    p_limit: limit,
  });

  if (error) {
    throw new RouteError('internal_error', 'Could not load your reviews.');
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json({
    reviews: rows.map((row) => ({
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
    })),
    count: rows.length,
  });
});
