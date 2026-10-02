import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/deposits/:id/submit-tx
//
// The user says "I have sent payment" and supplies a transaction hash (doc 84
// step 9).
//
// What this route explicitly does NOT do:
//  * it does not verify settlement (that is a separate server-side chain check)
//  * it does not mark the deposit VERIFIED
//  * it does not mark the deposit CONFIRMED
//  * it does not credit any balance
//  * it does not trust the optional screenshot in any way
//
// A submission moves PENDING -> SUBMITTED and nothing more (laws 44, 50).

const submitSchema = z.object({
  txHash: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Enter a valid transaction hash.'),
  // Accepted for completeness and ignored for credit purposes. Screenshot is
  // never settlement proof (law 50).
  screenshotReference: z.string().trim().max(500).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = route(async ({ user, body, params, correlationId }) => {
  const depositId = params.id;

  // The deposit id is a UUID. It is NOT validated with TX_HASH_RE: that regex
  // accepts a transaction hash, and no deposit id is one, so the original check
  // rejected every valid request and would have reported the error as an unknown
  // reference rather than as a malformed id.
  if (!depositId || !UUID_RE.test(depositId)) {
    throw new RouteError('invalid_request', 'Unknown deposit reference.');
  }

  const parsed = submitSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Enter the transaction hash of your transfer.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const admin = createAdminClient();

  // The whole transition happens in ONE database command.
  //
  // It used to be three separate operations here: a read to check ownership, a
  // PostgREST UPDATE to move PENDING -> SUBMITTED, and a second INSERT into
  // app.deposit_events for the audit trail. That shape was wrong twice over. It
  // could not have run at all, because the `app` schema is not exposed through
  // the Data API, and more importantly an event that failed to insert left a
  // deposit marked SUBMITTED with no record of who submitted it, while the route
  // merely logged and continued.
  //
  // `submit_deposit_tx` checks ownership, state and expiry, writes the state
  // change and the audit event in one transaction, and returns the same
  // "unknown reference" error for another user's deposit as for a nonexistent one.
  // This route no longer decides anything about the deposit.
  const { data: updated, error: submitError } = await admin.rpc('submit_deposit_tx', {
    p_user_id: user!.id,
    p_deposit_id: depositId,
    p_tx_hash: parsed.data.txHash,
    p_screenshot_reference: parsed.data.screenshotReference ?? null,
    p_correlation_id: correlationId,
  });

  if (submitError) {
    // The command uses errcode to say which precondition failed, so the message
    // can be specific without this route re-deriving the state.
    if (submitError.code === '23503') {
      throw new RouteError('not_found', 'Unknown deposit reference.');
    }

    if (submitError.code === '23514' || submitError.code === '23502') {
      console.error('[api] deposit submit rejected', {
        correlationId,
        code: submitError.code,
        error: submitError.message,
      });
      throw new RouteError('conflict', submitError.message);
    }

    console.error('[api] deposit submit failed', {
      correlationId,
      error: submitError.message,
    });
    throw new RouteError('internal_error', 'Could not record your transaction hash.');
  }

  const status = (updated as { status: string } | null)?.status ?? 'SUBMITTED';

  return NextResponse.json({
    // `status` is read back from the database rather than hardcoded. On an
    // idempotent replay the command returns the existing row unchanged, and
    // echoing a literal 'SUBMITTED' would have claimed a fresh transition that
    // did not happen.
    deposit: { id: depositId, status },
    message:
      'Transaction hash received. Your deposit is now being verified independently. ' +
      'It becomes available only after verification and an authorised confirmation.',
    nextStep:
      'Verification checks the network, token, destination and exact amount on Celo. A confirmed state is not yet a credited state.',
  });
});
