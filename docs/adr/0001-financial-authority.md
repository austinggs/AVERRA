# ADR-0001 - Financial authority lives in the database, orchestrated by server code

Status: Accepted
Date: 2026-09-30
Context docs: 50_BACKEND_ARCHITECTURE.txt, 53_SECURITY_ARCHITECTURE.txt, 71_ARCHITECTURAL_LAWS.md

## Context

Doc 50 permits privileged logic in "trusted server-side application logic OR Supabase
Edge Functions". For money that either/or is dangerous: two implementations of the same
financial rule can disagree, and whichever one runs last becomes accidental truth.

## Decision

1. All balance mutations and financial state transitions are implemented as SECURITY
   DEFINER functions in the app_private schema, with EXECUTE revoked from PUBLIC, anon
   and authenticated. Only server-side code holding the secret key can call them.
2. TypeScript performs orchestration and external I/O only (Celo RPC, providers, Daimo,
   notifications). External calls happen OUTSIDE database transactions.
3. Every financial mutation writes an outbox row in the same transaction, so a
   downstream side effect can never be lost.
4. Frontend and browser code never call a financial function directly.

## Consequences

- Atomicity, idempotency and uniqueness are enforced by the database, not by convention.
- A leaked publishable key cannot invoke a financial function.
- Two languages to review (SQL plus TypeScript); migrations need disciplined review and
  pgTAP coverage.
- Server-scoped reads that use the service key must enforce authorization in code,
  because RLS is bypassed. RLS remains enabled as defence in depth.
