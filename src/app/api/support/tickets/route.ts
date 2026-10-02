import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// POST /api/support/tickets
//
// Opens a support ticket. Creates a record only: it moves no money, grants no
// exception and cannot confirm a deposit or approve a withdrawal. A Telegram
// conversation cannot do those things either (law 59, doc 85 section 6).

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Add a short subject.').max(160),
  body: z.string().trim().min(1, 'Describe the issue.').max(8000),
  category: z.string().trim().max(60).default('Other'),
  // Optional links to the user's own records, for traceability. Ownership of
  // each is checked before the link is stored.
  linkedDepositId: z.string().uuid().optional(),
  linkedWithdrawalId: z.string().uuid().optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Please correct the highlighted fields.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  // Confirm each linked record belongs to the caller before referencing it.
  //
  // Routed through `public.owns_my_deposit` / `public.owns_my_withdrawal`, NOT
  // `.from('deposit_requests')`. The `app` schema is not exposed through the Data
  // API. The wrappers return a boolean rather than a row, so this validation
  // cannot become a deposit read.
  if (input.linkedDepositId) {
    const { data } = await admin.rpc('owns_my_deposit', {
      p_user_id: user!.id,
      p_deposit_id: input.linkedDepositId,
    });

    if (data !== true) {
      throw new RouteError('not_found', 'Unknown deposit reference.');
    }
  }

  if (input.linkedWithdrawalId) {
    const { data } = await admin.rpc('owns_my_withdrawal', {
      p_user_id: user!.id,
      p_withdrawal_id: input.linkedWithdrawalId,
    });

    if (data !== true) {
      throw new RouteError('not_found', 'Unknown withdrawal reference.');
    }
  }

  const { data: created, error } = await admin.rpc('create_support_ticket', {
    p_user_id: user!.id,
    p_subject: input.subject,
    p_body: input.body,
    p_category: input.category,
    p_linked_deposit_id: input.linkedDepositId ?? null,
    p_linked_withdrawal_id: input.linkedWithdrawalId ?? null,
    p_correlation_id: correlationId,
  });

  if (error) {
    console.error('[api] create ticket failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not open your support ticket.');
  }

  const ticket = Array.isArray(created) ? created[0] : created;

  return NextResponse.json(
    {
      ticket: {
        id: ticket?.id,
        reference: ticket?.reference,
        status: ticket?.status,
        category: ticket?.category,
        subject: ticket?.subject,
        createdAt: ticket?.created_at,
      },
      message:
        'Your ticket has been received. A human support agent will reply here. ' +
        'Automated notifications will tell you when something happens, but only a human agent writes replies.',
    },
    { status: 201 },
  );
});

// GET /api/support/tickets
//
// The caller's own tickets only. No admin capability is involved: a user always
// sees their own cases, and never anyone else's.
export const GET = route(async ({ user, searchParams }) => {
  const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);
  const statusParam = searchParams.get('status');

  const admin = createAdminClient();

  // Routed through `public.list_my_support_tickets`, NOT `.from('support_tickets')`.
  // The `app` schema is not exposed through the Data API. The caller scoping and
  // the status filter both happen in the database.
  const { data, error } = await admin.rpc('list_my_support_tickets', {
    p_user_id: user!.id,
    p_limit: limit,
    p_status: statusParam,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not read your tickets.' } },
      { status: 500 },
    );
  }

  const tickets = (data ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json({
    tickets: tickets.map((row) => ({
      id: row.id as string,
      reference: row.reference as string,
      category: row.category as string,
      subject: row.subject as string,
      status: row.status as string,
      priority: row.priority as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string | null,
      firstResponseAt: row.firstResponseAt as string | null,
      resolvedAt: row.resolvedAt as string | null,
      closedAt: row.closedAt as string | null,
      reopenCount: row.reopenCount as number | null,
    })),
    count: tickets.length,
  });
});
