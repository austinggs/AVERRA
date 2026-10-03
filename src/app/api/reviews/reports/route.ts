import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASON_MAX,
  REVIEW_CONTENT_TARGETS,
} from '@/lib/reviews/contract';

// POST /api/reviews/reports
//
// Reports a review, comment or media object (doc 86 REPORTING / MODERATION).
//
// A report is an OPINION about content and nothing else. It posts no ledger entry,
// moves no balance, and cannot hide anything - `review_reports_once_per_target`
// means one report per user per item, and the decision belongs to a human
// moderator (law 63, law 67).

const reportSchema = z.object({
  targetType: z.enum(REVIEW_CONTENT_TARGETS),
  targetId: z.string().uuid(),
  // Free text, matching `review_reports.reason_code`. It is NOT restricted to the
  // UI's suggestion list, because the database stores whatever a user says and
  // rejecting an unlisted reason would refuse a legitimate report.
  reasonCode: z.string().trim().min(1, 'Choose a reason.').max(REPORT_REASON_MAX),
  details: z.string().trim().max(REPORT_DETAILS_MAX).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = reportSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  // Routed through `public.report_review_content`, NOT `.from('review_reports')`.
  // The `app` schema is not exposed through the Data API. p_reporter_id comes from
  // the verified session, never the body, so a user cannot file a report as
  // somebody else.
  const { data, error } = await admin.rpc('report_review_content', {
    p_reporter_id: user!.id,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason_code: input.reasonCode,
    p_details: input.details ?? null,
    p_correlation_id: correlationId,
  });

  if (error) {
    const code = error.code as string | undefined;
    const message = String(error.message ?? '');

    // `review_reports_once_per_target`: the user already reported this item. The
    // unique violation is reported as a conflict, not as a crash.
    if (code === '23505' || /already been reported|once_per_target/i.test(message)) {
      throw new RouteError('conflict', 'You have already reported this.');
    }

    // The command establishes `target_exists` at write time because the target is
    // polymorphic and cannot be a foreign key.
    if (code === '23503' || /does not exist|not found/i.test(message)) {
      throw new RouteError('not_found', 'That content could not be found.');
    }

    if (code === '42501') {
      throw new RouteError('forbidden', message || 'You cannot report that.');
    }

    console.error('[api] report content failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not send your report.');
  }

  const report = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return NextResponse.json(
    {
      report: {
        id: report?.id as string,
        targetType: report?.target_type as string,
        status: report?.status as string,
        createdAt: report?.created_at as string,
      },
      message:
        'Thank you. A human moderator will look at this. Reports are reviewed by ' +
        'people, not automatically, and reporting does not remove anything by itself.',
    },
    { status: 201 },
  );
});
