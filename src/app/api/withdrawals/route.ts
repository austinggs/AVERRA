import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { quoteWithdrawal, FEE_NOTICE } from '@/lib/financial/withdrawal';
import { getWalletSummary } from '@/lib/wallet/summary';
import { WITHDRAWAL_METHODS } from '@/lib/financial/withdrawal';
import { errorFields } from '@/lib/observability/errors';

// POST /api/withdrawals
//
// Creates a withdrawal request. Two things matter here beyond the mechanics:
//
// 1. THE FEE IS DISCLOSED BEFORE CONFIRMATION (law 45, doc 83). The response
//    carries the exact gross, fee and net amounts and the required notice text,
//    and those exact numbers are what the database stores. The UI displays what
//    this endpoint returned, so the amount shown is the amount honoured.
//
// 2. ONLY EARNED REWARD BALANCE IS WITHDRAWABLE (doc 37, law 56). The available
//    figure comes from the earned-reward ledger, never from the funding balance.

const createSchema = z.object({
  method: z.enum(WITHDRAWAL_METHODS),
  destinationId: z.string().uuid(),
  grossMinor: z.coerce.bigint().positive(),
  unit: z.string().trim().min(2).max(12),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Check the withdrawal method, destination and amount.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { method, destinationId, grossMinor, unit, idempotencyKey } = parsed.data;

  const quote = quoteWithdrawal(grossMinor);

  const admin = createAdminClient();

  // Pre-flight the eligibility read so the user gets a clear reason before the
  // database refuses. The database remains the authority either way.
  const wallet = await getWalletSummary(user!.id);
  const earned = wallet.earnedRewards.find((b) => b.unit === unit);

  if (!earned) {
    throw new RouteError(
      'insufficient_funds',
      'You have no earned reward balance in that currency.',
    );
  }

  if (earned.availableMinor < grossMinor) {
    throw new RouteError(
      'insufficient_funds',
      'Your available earned reward balance is too low for this withdrawal. ' +
        'User Funding Balance cannot be withdrawn.',
    );
  }

  const idempotencyKeyValue = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'withdrawal.create',
    provided: idempotencyKey,
    payload: { method, destinationId, grossMinor: grossMinor.toString(), unit },
  });

  const { data: created, error } = await admin.rpc('create_withdrawal_request', {
    p_user_id: user!.id,
    p_method: method,
    p_destination_id: destinationId,
    p_gross_minor: grossMinor.toString(),
    p_unit: unit,
    p_idempotency_key: idempotencyKeyValue,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    if (message.includes('insufficient available earned balance')) {
      throw new RouteError(
        'insufficient_funds',
        'Your available earned reward balance is too low.',
      );
    }

    if (message.includes('destination is not verified')) {
      throw new RouteError(
        'destination_not_verified',
        'That payout destination has not been verified.',
      );
    }

    if (message.includes('lacks a verification record')) {
      throw new RouteError(
        'destination_not_verified',
        'That payout destination has not been verified.',
      );
    }

    if (message.includes('does not match request method')) {
      throw new RouteError('invalid_request', 'That destination cannot be used for this method.');
    }

    if (message.includes('destination not found')) {
      throw new RouteError('not_found', 'Unknown payout destination.');
    }

    console.error('[api] create withdrawal failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not create the withdrawal request.');
  }

  const request = Array.isArray(created) ? created[0] : created;

  return NextResponse.json(
    {
      withdrawal: {
        id: request?.id,
        status: request?.status,
        method,
        unit,
        grossMinor: quote.grossMinor.toString(),
        feeMinor: quote.feeMinor.toString(),
        netMinor: quote.netMinor.toString(),
      },
      disclosure: {
        notice: FEE_NOTICE,
        grossMinor: quote.grossMinor.toString(),
        feeMinor: quote.feeMinor.toString(),
        netMinor: quote.netMinor.toString(),
        feeBasisPoints: quote.feeBasisPoints,
      },
      idempotencyKey: idempotencyKeyValue,
    },
    { status: 201 },
  );
});
