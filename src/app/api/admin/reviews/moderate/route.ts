import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';
import { REVIEW_CONTENT_TARGETS, REVIEW_MODERATION_ACTIONS } from '@/lib/reviews/contract';

// POST /api/admin/reviews/moderate
//
// Records a human moderator's decision (doc 86 MODERATION, law 67).
//
// This is the one route that changes review state, and it can only do what a
// moderator is allowed to do: it cannot edit a review, delete evidence, or touch
// money. `review_moderation_actions` is append-only, so a correction is a NEW
// action (RESTORE after HIDE) and never an edit of the old one.
//
// LAW 67 IS THE POINT: there is no AI fallback here. If this route is unreachable,
// nothing is auto-approved and nothing is auto-hidden - the content simply stays
// PENDING, which is the safe direction to fail in.

const moderateSchema = z.object({
  targetType: z.enum(REVIEW_CONTENT_TARGETS),
  targetId: z.string().uuid(),
  action: z.enum(REVIEW_MODERATION_ACTIONS),
  reasonCode: z.string().trim().min(1, 'A reason code is required.').max(80),
  evidenceReference: z.string().trim().max(200).optional(),
});

export const POST = route(
  async ({ user, body, correlationId }) => {
    const parsed = moderateSchema.safeParse(body);

    if (!parsed.success) {
      throw new RouteError(
        'validation_failed',
        'Please correct the highlighted fields.',
        parsed.error.flatten().fieldErrors,
      );
    }

    const input = parsed.data;
    const admin = createAdminClient();

    // Routed through `public.moderate_review_content`, NOT `.from(
    // 'review_moderation_actions')`. p_moderator_id is the verified session user.
    // The wrapper re-checks `review.moderate` in SQL via
    // `operator_has_capability`, so a revoked operator is refused twice over.
    const { data, error } = await admin.rpc('moderate_review_content', {
      p_moderator_id: user!.id,
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_action: input.action,
      p_reason_code: input.reasonCode,
      p_evidence_reference: input.evidenceReference ?? null,
      p_correlation_id: correlationId,
    });

    if (error) {
      const code = error.code as string | undefined;
      const message = String(error.message ?? '');

      if (code === '42501') {
        throw new RouteError('forbidden', message || 'You cannot moderate this content.');
      }

      // An action that is not legal from the content's current state. This is the
      // operator's mistake, not a server fault, so it is a 409 and names the
      // problem instead of pretending the action succeeded.
      if (code === '23514' || /cannot|not allowed|illegal|invalid transition/i.test(message)) {
        throw new RouteError('conflict', message || 'That action is not valid right now.');
      }

      if (code === '23503' || /does not exist/i.test(message)) {
        throw new RouteError('not_found', 'That content could not be found.');
      }

      console.error('[api] moderate review failed', errorFields(error, { correlationId }));
      throw new RouteError('internal_error', 'Could not record that moderation decision.');
    }

    const action = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

    return NextResponse.json(
      {
        action: {
          id: action?.id as string,
          targetType: action?.target_type as string,
          targetId: action?.target_id as string,
          action: action?.action as string,
          reasonCode: action?.reason_code as string,
          createdAt: action?.created_at as string,
        },
        message: 'Decision recorded in the moderation log.',
      },
      { status: 201 },
    );
  },
  { capability: 'review.moderate' },
);
