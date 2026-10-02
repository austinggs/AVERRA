import { NextResponse } from 'next/server';
import { processOutboxBatch, getOutboxBacklog } from '@/lib/observability/outbox';
import { logger } from '@/lib/observability/logger';

// POST /api/internal/outbox/drain
//
// Drains a batch of the transactional outbox.
//
// INVOCATION SECURITY
//
// This is a worker endpoint, not a user endpoint. It is protected by a shared
// secret compared with a constant-time equality check, because there is no user
// session to authorise against and the endpoint is deliberately not capability
// gated. The alternative - a service-role capability - would mean granting a
// durable administrative privilege purely to run a job.
//
// A 401 from this route must never be treated as "the batch ran anyway".
function isAuthorised(request: Request, expected: string): boolean {
  const provided = request.headers.get('x-worker-secret') ?? '';

  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < provided.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return mismatch === 0;
}

export async function POST(request: Request) {
  const expected = process.env.OUTBOX_WORKER_SECRET ?? '';

  if (!expected) {
    // Fail closed. An unset secret means the endpoint is not configured, and an
    // unconfigured worker endpoint must not be open.
    logger.error('outbox.drain_unconfigured', {
      reason: 'OUTBOX_WORKER_SECRET is not set',
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Worker endpoint is not configured.' } },
      { status: 503 },
    );
  }

  if (!isAuthorised(request, expected)) {
    logger.warn('outbox.drain_unauthorised', {});
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Not authorised.' } },
      { status: 401 },
    );
  }

  const result = await processOutboxBatch(50);

  return NextResponse.json({ ...result, backlog: await getOutboxBacklog() });
}

// GET /api/internal/outbox/backlog
//
// Queue depth, for the operational dashboard (doc 62).
export async function GET(request: Request) {
  const expected = process.env.OUTBOX_WORKER_SECRET ?? '';

  if (!expected || !isAuthorised(request, expected)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Not authorised.' } },
      { status: 401 },
    );
  }

  return NextResponse.json({ backlog: await getOutboxBacklog() });
}
