import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// POST /api/admin/reviews/reports/[reportId]/resolve
//
// Closes a report (doc 86 MODERATION).
//
// Deliberately a SEPARATE route from the moderation action, because they are
// different decisions: RESOLVED means the report led to action, DISMISSED means it
// did not. One route that could do both would let an operator close a report
// without acting on it while the log implied otherwise, and the queue exists to
// preserve that distinction.
//
// Resolving a report does NOT remove the content. That is a separate, deliberate
// moderation action, and this route cannot take it.

const resolveSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED', 'IN_REVIEW']),
  reasonCode: z.string().trim().min(1, 'A reason code is required.').max(80),
});

export const POST = route(
  async ({ user, params, body, correlationId }) => {
    const parsed = resolveSchema.safeParse(body);

    if (!parsed.success) {
      throw new RouteError(
        'validation_failed',
        'Please correct the highlighted fields.',
        parsed.error.flatten().fieldErrors,
      );
    }

    const input = parsed.data;
    const admin = createAdminClient();

    // Routed through `public.resolve_review_report`. p_moderator_id is the verified
    // session user; the wrapper re-checks `review.moderate` in SQL.
    const { data, error } = await admin.rpc('resolve_review_report', {
      p_moderator_id: user!.id,
      p_report_id: params.reportId,
      p_status: input.status,
      p_reason_code: input.reasonCode,
      p_correlation_id: correlationId,
    });

    if (error) {
      const code = error.code as string | undefined;
      const message = String(error.message ?? '');

      if (code === '42501') {
        throw new RouteError('forbidden', message || 'You cannot resolve this report.');
      }

      if (code === '23503' || /does not exist/i.test(message)) {
        throw new RouteError('not_found', 'That report could not be found.');
      }

      if (code === '23514' || /cannot|already/i.test(message)) {
        throw new RouteError('conflict', message || 'That report is not in a resolvable state.');
      }

      console.error('[api] resolve report failed', errorFields(error, { correlationId }));
      throw new RouteError('internal_error', 'Could not resolve that report.');
    }

    const report = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

    return NextResponse.json({
      report: {
        id: report?.id as string,
        status: report?.status as string,
        resolvedAt: report?.resolved_at as string | null,
      },
      message: 'Report closed.',
    });
  },
  { capability: 'review.moderate' },
);
