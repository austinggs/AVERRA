# ADR-0003 - Withdrawal state is three orthogonal fields

Status: Accepted
Date: 2026-09-30
Context docs: 37_WITHDRAWAL_SYSTEM.txt, 87_ADMIN_PORTAL_EXPANDED.md, 48_DATABASE_SCHEMA.txt; finding F-03

## Context

Doc 37 and doc 87 described the withdrawal lifecycle with non-equivalent tokens
(ELIGIBILITY_CHECKED vs ELIGIBILITY_CHECK; PAYMENT_INITIATED and COMPLETED only in 37;
SETTLEMENT and RECONCILED only in 87).

## Decision

Model three lifecycles as three fields rather than replacing one vocabulary with
the other:

1. withdrawal_status - the user-visible workflow (doc 37 vocabulary, retained).
2. payment_settlement_status - the payment operation (absorbs SETTLEMENT).
3. reconciliation_status - accounting reconciliation (absorbs RECONCILED).

Invariants recorded: APPROVED never means PAID. CONFIRMED never means RECONCILED.

## Consequences

- No state value is lost; every doc-37 and doc-87 token survives.
- Reward and withdrawal lifecycles remain separate enum types. ELIGIBILITY_CHECKED
  exists in both domains and must never be collapsed into one shared enum.
