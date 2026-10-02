AVERRA — AVERRA — MILESTONES

Document: 77_MILESTONES.md
Version: 1.1
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines milestone groups and exit criteria.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

M1 FOUNDATION
CI/CD, environments, auth, DB baseline, observability, source-of-truth process.

M2 FINANCIAL CORE
Reward Engine + ledger + audit + tests with no direct client financial mutation.

M3 PROVIDER CORE
At least one approved provider integrated end-to-end, then adapter framework supports additional providers.

M4 EARNING SURFACE
Tasks/offers/surveys user journeys plus status transparency.

M5 MINING GAME CORE
Playable server-authoritative Mining Game with asset provenance and performance controls.

M6 PAYMENTS
Withdrawal system, manual MiniPay/bank, User Funding & Deposit System, admin-confirmed MiniPay deposits, Cash Link operations, transparent 15% service/maintenance fee, Daimo deposit with Hurry/one-hour design, and verified automatic Daimo payout integration if approved.

M7 PRODUCTION READINESS
Security, fraud, support, compliance, reconciliation, monitoring, DR, performance, and acceptance sign-off.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.

M7 PRODUCTION READINESS (ADDITION)
Reviews/Community launch readiness: public review UX, media security, RLS, moderation workflows, support/financial separation, Verified Experience correctness, and acceptance/security testing.
