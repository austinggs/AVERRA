import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/support/tickets/[id]  (user reply)
//
// Adds a USER message to an existing ticket.
//
// THIS ROUTE CAN ONLY POST A USER MESSAGE. It calls `post_user_reply`, which
// stamps `author_kind = 'USER'`. It cannot post an agent reply: that path is
// `post_agent_reply`, it is admin-only, and it requires a verified human agent
// identity server-side (law 58, doc 44).
//
// There is no generated reply here and no summarisation of the thread. Anything
// an automated system produced would be unattributable, and an unattributed
// support message is unauditable (the `support_messages_author_present`
// constraint exists for exactly this reason).
//
// It also moves no money and grants no exception. A support conversation cannot
// credit a deposit or approve a withdrawal, by any channel (law 59).

const replySchema = z.object({
  body: z.string().trim().min(2, 'Write a reply.').max(8000),
});

export const POST = route(async ({ user, body, params, correlationId }) => {
  const ticketId = params.id;

  if (!ticketId) {
    throw new RouteError('invalid_request', 'Unknown ticket.');
  }

  const parsed = replySchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('post_user_reply', {
    p_ticket_id: ticketId,
    p_user_id: user!.id,
    p_body: parsed.data.body,
  });

  if (error) {
    const message = error.message;

    if (message.includes('does not belong')) {
      // Do not leak whether another user's ticket exists.
      throw new RouteError('not_found', 'Unknown ticket.');
    }

    if (message.includes('not open') || message.includes('closed')) {
      throw new RouteError('conflict', 'This ticket is closed and cannot receive replies.');
    }

    console.error('[api] user support reply failed', { correlationId, error: error.message });
    throw new RouteError('internal_error', 'Could not send your reply.');
  }

  const ticket = Array.isArray(data) ? data[0] : data;

  return NextResponse.json(
    {
      ticket: { id: ticket?.id, status: ticket?.status },
      message: 'Your reply was added. A human agent will read it.',
    },
    { status: 201 },
  );
});
