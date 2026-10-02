import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/admin/support/tickets/:id/reply
//
// THE HUMAN-ONLY SUPPORT BOUNDARY (law 57, law 66, doc 85 section 1).
//
// This endpoint writes an AGENT message into the authoritative support thread.
// Three controls stand in the way of any automated writer:
//
//   1. It requires the `support.reply` capability, re-checked server-side on
//      every request from the database, never from client state.
//   2. The acting identity is the operator resolved from a verified JWT. The
//      request body CANNOT specify who the author is.
//   3. app.author_kind has no 'SYSTEM' value, so there is no code path, no
//      parameter and no enum member that lets a system post into this thread.
//
// There is deliberately no "generate a reply" endpoint and no field an AI could
// write into on a user's behalf.

const replySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply.').max(8000),
  // Optional status to set alongside the reply.
  setStatus: z
    .enum([
      'OPEN',
      'ASSIGNED',
      'IN_PROGRESS',
      'WAITING_FOR_USER',
      'WAITING_FOR_INTERNAL_TEAM',
      'RESOLVED',
    ])
    .optional(),
  attachmentRefs: z.array(z.string().max(300)).max(10).default([]),
});

export const POST = route(
  async ({ user, body, params, correlationId }) => {
    const ticketId = params.id;

    if (!ticketId) {
      throw new RouteError('invalid_request', 'Unknown ticket.');
    }

    const parsed = replySchema.safeParse(body);

    if (!parsed.success) {
      throw new RouteError(
        'validation_failed',
        'A reply body is required.',
        parsed.error.flatten().fieldErrors,
      );
    }

    const admin = createAdminClient();

    const { data: updated, error } = await admin.rpc('post_agent_reply', {
      p_ticket_id: ticketId,
      // The operator identity is the verified session user, never the body.
      p_agent_id: user!.id,
      p_body: parsed.data.body,
      p_set_status: parsed.data.setStatus ?? null,
      p_attachment_refs: parsed.data.attachmentRefs,
      p_correlation_id: correlationId,
    });

    if (error) {
      const message = error.message;

      if (message.includes('identified human agent')) {
        throw new RouteError('forbidden', 'An identified agent is required to reply.');
      }

      if (message.includes('is closed and must be reopened')) {
        throw new RouteError('conflict', 'This ticket is closed. Reopen it before replying.');
      }

      console.error('[api] agent reply failed', { correlationId, error: error.message });
      throw new RouteError('internal_error', 'Could not post that reply.');
    }

    const ticket = Array.isArray(updated) ? updated[0] : updated;

    return NextResponse.json({
      ticket: {
        id: ticket?.id,
        reference: ticket?.reference,
        status: ticket?.status,
        firstResponseAt: ticket?.first_response_at,
      },
      message: 'Reply recorded as a human agent message.',
    });
  },
  { capability: 'support.reply' },
);
