import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/admin/reviews
//
// The two human moderation queues (doc 86 MODERATION, doc 87 REVIEWS / COMMUNITY
// ADMIN):
//
//   ?queue=pending   reviews waiting for a publication decision
//   ?queue=reports   open user reports, with the content each one points at
//
// Requires `review.moderate`. The wrapper re-checks the same capability in SQL, so
// authorization happens twice on purpose: the route check gives a clean 403, and
// the SQL check holds even if this file is ever bypassed.
//
// The queue returns `verifiedExperienceId`, which the public projection withholds.
// That is the moderator-only evidence behind a Verified Experience badge, and law
// 69's exception is exactly this surface.
//
// NOTHING HERE IS AN AI DECISION. Every action a moderator takes is recorded as a
// human row in `review_moderation_actions` (law 67). This route only reads.

const QUEUES = ['pending', 'reports'] as const;
type Queue = (typeof QUEUES)[number];

export const GET = route(
  async ({ user, searchParams }) => {
    const queueParam = searchParams.get('queue') ?? 'pending';
    const limitParam = Number(searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    // An unrecognised queue is a bad request rather than a silent fall back to
    // `pending`. Falling back would show an operator one queue while they believed
    // they were looking at another - the "0 rows means nothing matched" failure.
    if (!QUEUES.includes(queueParam as Queue)) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: `Unknown queue. Expected one of: ${QUEUES.join(', ')}.`,
          },
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Both wrappers take p_moderator_id and verify `review.moderate` in SQL, so a
    // revoked operator fails even though this route already authorized them.
    //
    // p_moderator_id is the VERIFIED SESSION user, never anything from the query
    // string. Taking it from `searchParams` would let any caller nominate the
    // operator whose capability is then checked - which is precisely the
    // authorization the wrapper exists to perform.
    const rpcName =
      queueParam === 'pending' ? 'list_reviews_awaiting_publication' : 'list_review_reports';

    const { data, error } = await admin.rpc(rpcName, {
      p_moderator_id: user!.id,
      p_limit: limit,
    });

    if (error) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Could not read the moderation queue.' } },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    return NextResponse.json({
      queue: queueParam,
      items: rows,
      count: rows.length,
    });
  },
  { capability: 'review.moderate' },
);
