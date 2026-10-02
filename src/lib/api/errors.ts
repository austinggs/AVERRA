import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthorizationError, UnauthenticatedError } from '@/lib/auth/capabilities';

// A single error shape for every route handler (doc 49 CONVENTIONS).
//
// Errors must be explicit about the financial reason and must NOT leak internal
// evidence: a user learns "this transaction hash is already recorded", never
// which internal record it collided with.

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'validation_failed'
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'unsupported_token'
  | 'wrong_network'
  | 'expired_request'
  | 'duplicate_transaction'
  | 'amount_mismatch'
  | 'needs_review'
  | 'unverified_settlement'
  | 'insufficient_funds'
  | 'destination_not_verified'
  | 'rate_limited'
  /**
   * Game energy is exhausted. Deliberately distinct from `insufficient_funds`:
   * energy is a virtual game resource (law 26), not money, and reporting it as
   * a funds problem would misdescribe it.
   */
  | 'insufficient_energy'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  validation_failed: 422,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  unsupported_token: 422,
  wrong_network: 422,
  expired_request: 409,
  duplicate_transaction: 409,
  amount_mismatch: 422,
  needs_review: 409,
  unverified_settlement: 409,
  insufficient_funds: 422,
  destination_not_verified: 403,
  rate_limited: 429,
  insufficient_energy: 409,
  internal_error: 500,
};

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  options?: { correlationId?: string; details?: unknown },
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
        ...(options?.details !== undefined ? { details: options.details } : {}),
      },
    },
    { status: STATUS_BY_CODE[code] },
  );
}

/**
 * Converts a thrown error into a response. An unexpected error becomes a generic
 * 500 with no detail: internal messages frequently contain table names, ids or
 * provider payloads, which must not reach a browser.
 */
export function handleRouteError(
  error: unknown,
  correlationId?: string,
): NextResponse<ApiErrorBody> {
  if (error instanceof UnauthenticatedError) {
    return apiError('unauthenticated', error.message, { correlationId });
  }

  if (error instanceof AuthorizationError) {
    return apiError('forbidden', error.message, { correlationId });
  }

  if (error instanceof ZodError) {
    return apiError('validation_failed', 'The request body failed validation.', {
      correlationId,
      details: error.flatten().fieldErrors,
    });
  }

  if (error instanceof RouteError) {
    return apiError(error.code, error.message, { correlationId, details: error.details });
  }

  // Deliberately opaque. The real cause is logged server-side by the caller.
  console.error('[api] unhandled route error', { correlationId, error });
  return apiError('internal_error', 'Something went wrong. Please try again.', { correlationId });
}

/** An error with an explicit API code, for expected domain failures. */
export class RouteError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}
