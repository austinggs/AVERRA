import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { getSessionUser, type SessionUser } from '@/lib/auth/session';
import { requireCapability } from '@/lib/auth/capabilities';
import { apiError, handleRouteError, type ApiErrorBody } from '@/lib/api/errors';

// Shared plumbing for route handlers.
//
// The rule every handler follows: authenticate, authorize, validate, then act.
// The client may submit evidence and request an action, but it can never approve,
// verify, credit or confirm anything (laws 3, 41, 44).

export type RouteContext = {
  /** Verified user, or null when unauthenticated. */
  user: SessionUser | null;
  correlationId: string;
  /** Parsed body for POST/PUT/PATCH. */
  body: unknown;
  params: Record<string, string>;
  searchParams: URLSearchParams;
};

export type RouteHandlerOptions = {
  /** When set, the caller must hold this capability. */
  capability?: string;
  /** Reject unauthenticated callers outright. Defaults to true. */
  requireAuth?: boolean;
};

export function newCorrelationId(): string {
  return randomUUID();
}

/** Wraps a handler with authentication, authorization, and error shaping. */
export function route(
  handler: (ctx: RouteContext) => Promise<NextResponse>,
  options: RouteHandlerOptions = {},
) {
  const requireAuth = options.requireAuth ?? true;

  return async (
    request: Request,
    routeContext?: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse<ApiErrorBody> | NextResponse> => {
    const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();

    try {
      const user = await getSessionUser();

      if (requireAuth && !user) {
        return apiError('unauthenticated', 'You must be signed in.', { correlationId });
      }

      if (options.capability && user) {
        await requireCapability(user, options.capability);
      }

      let body: unknown = undefined;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const text = await request.text();
        body = text.length > 0 ? JSON.parse(text) : undefined;
      }

      const url = new URL(request.url);
      const params = routeContext?.params ? await routeContext.params : {};

      const ctx: RouteContext = {
        user,
        correlationId,
        body,
        params,
        searchParams: url.searchParams,
      };

      const response = await handler(ctx);

      response.headers.set('x-correlation-id', correlationId);
      return response;
    } catch (error) {
      return handleRouteError(error, correlationId);
    }
  };
}
