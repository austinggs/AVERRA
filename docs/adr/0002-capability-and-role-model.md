# ADR-0002 - Capabilities are the authorization primitive; roles are bundles

Status: Accepted
Date: 2026-09-30
Context docs: 43_ADMIN_PLATFORM.txt, 56_FINANCIAL_CONTROLS.txt, 84, 87; findings F-02, R-03

## Context

Docs 38, 43, 56 and 84 used one role vocabulary; doc 87 used another. Names and
responsibilities differed (DEPOSIT_APPROVER vs PAYMENT_APPROVER vs DEPOSIT_REVIEWER,
and RECONCILIATION_OPERATOR had no counterpart). Merging two lists would not have fixed
it, because the disagreement was about what each role may DO.

## Decision

1. Authorization checks a capability code, never a role label.
2. Roles are named bundles of capabilities (app.admin_roles plus
   app.admin_role_capabilities).
3. The same capability codes are used in SQL guards, RLS, server routes and the admin UI.
4. Legacy labels survive as mappings, not as a parallel system:
   - PAYMENT_OPERATOR, DEPOSIT_APPROVER, RECONCILIATION_OPERATOR are canonical roles.
   - SUPPORT_VIEWER becomes a read-only capability subset of SUPPORT_AGENT.
   - DEPOSIT_REVIEWER covers triage/preparation; PAYMENT_APPROVER covers withdrawal
     approval.
5. Dual control is an invariant, not a UI rule: an approver may never be the preparer.

## Consequences

- Adding a role no longer requires touching authorization logic.
- The canonical matrix lives in doc 43 and is mirrored by seeded rows in migration 002.
