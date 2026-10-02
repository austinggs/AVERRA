import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveTokens, getActiveDestination } from '@/lib/deposits/config';
import { errorFields } from '@/lib/observability/errors';

// POST /api/deposits
//
// Creates a Manual MiniPay crypto deposit request (doc 84 USER FLOW steps 1-6).
//
// What the client may do: choose an asset from the server-provided allowlist and
// declare an amount. What the client may NOT do: supply a contract address,
// invent a network, or self-credit. The server returns the destination, the
// active allowlist, the reference and the expiry.

const createSchema = z.object({
  symbol: z.string().trim().min(2).max(10),
  amountMinor: z.coerce.bigint().positive(),
  senderAddress: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a valid 0x address.')
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Enter a supported token and a positive amount.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { symbol, amountMinor, senderAddress, idempotencyKey } = parsed.data;

  const admin = createAdminClient();

  const { data: created, error } = await admin.rpc('create_deposit_request', {
    p_user_id: user!.id,
    p_declared_symbol: symbol,
    p_declared_amount_minor: amountMinor.toString(),
    p_sender_address: senderAddress ?? null,
  });

  if (error) {
    // The function raises for an unsupported or inactive token. Surface the
    // reason rather than a generic failure (doc 49 ERROR MODEL).
    const message = error.message;

    if (message.includes('not an active supported token')) {
      throw new RouteError(
        'unsupported_token',
        'That token is not currently supported for deposits.',
      );
    }

    if (message.includes('no active Averra deposit destination')) {
      throw new RouteError(
        'invalid_request',
        'Deposits are not available right now. Please contact support.',
      );
    }

    console.error('[api] create deposit failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'Could not start a deposit request.');
  }

  const request = Array.isArray(created) ? created[0] : created;
  const requestId = request?.id as string | undefined;

  if (!requestId) {
    throw new RouteError('internal_error', 'Could not start a deposit request.');
  }

  const [tokens, destination] = await Promise.all([getActiveTokens(), getActiveDestination()]);

  const key = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'deposit.create',
    provided: idempotencyKey ?? (requestId as string),
    payload: { symbol, amountMinor: amountMinor.toString() },
  });

  // The idempotency key is returned so a client retry can reuse it. It is a
  // deduplication token, not an authorisation token.
  return NextResponse.json(
    {
      deposit: {
        id: requestId,
        reference: request.request_reference as string,
        status: request.status as string,
        symbol,
        declaredAmountMinor: amountMinor.toString(),
        chainId: request.chain_id as number,
        expiresAt: request.expires_at as string,
        requestedAt: request.requested_at as string,
      },
      network: { name: 'Celo', chainId: 42220 },
      supportedTokens: tokens,
      destination,
      warning:
        'Unsupported tokens or the wrong network will lead to loss of funds. ' +
        'Native CELO is not accepted. Double-check the network is Celo and the token is one of those listed above before sending.',
      idempotencyKey: key,
    },
    { status: 201 },
  );
});
