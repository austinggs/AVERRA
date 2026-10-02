AVERRA — TESTING STRATEGY

Document: 65_TESTING_STRATEGY.md
Version: 1.1
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Master test strategy and quality gates.

LAYERS
Unit, component, integration, contract/API, end-to-end, security, financial, performance, disaster-recovery, and acceptance testing.

REQUIRED GATES
Feature changes affecting money, identity, providers, payouts, deposits, or game authority require targeted regression tests before merge.

MINIPAY DEPOSIT FIXTURES
Use deterministic fixtures for supported Celo token contracts, destination addresses, sender addresses, transaction hashes, token transfer events/logs, confirmation depths, expired requests, wrong tokens, wrong networks, underpayment, overpayment, duplicate submissions, and late transfers.

ENVIRONMENT RULE
Production data is never used casually in tests. Provider-approved sandbox/test mechanisms or controlled testnet fixtures are preferred where available.

RELEASE GATE
All required tests pass, typecheck/lint/build pass, no unresolved high-severity defects, acceptance criteria satisfied, and progress/documentation updated.


SUPPORT TESTING
- Verify users can create and view tickets without external notification services.
- Verify support-agent replies are human-authored records and are visibly distinguished from automated system notifications.
- Verify there is no production AI-to-user support reply path.
- Verify in-app unread counts and notification records are idempotent and resilient to refresh/retry.
- Verify Telegram-originated cases can be linked to an in-app ticket without granting financial authority.

REVIEWS / COMMUNITY TESTING
Required tests include review creation/edit/delete, public visibility rules, threaded comments, image upload validation, duplicate/retry behavior, reporting, moderation permissions, Verified Experience derivation, rating aggregation, notification creation, RLS, Storage access, and protection against public exposure of private support/financial evidence.
