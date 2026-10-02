AVERRA — AVERRA — AI DEVELOPMENT RULES

Document: 78_AI_DEVELOPMENT_RULES.md
Version: 1.1
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Instructions for coding agents and AI-assisted engineering.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

BEFORE EDITING
Read source-of-truth docs, inspect code/tests, identify current implementation state, locate contracts and dependencies.

CHANGE DISCIPLINE
Smallest coherent change. No unrelated refactors. No bypassing architecture laws. Do not introduce hidden assumptions.

FINANCIAL RULE
Never edit balances from UI code or ad-hoc handlers. Use Reward Engine, Ledger, Funding/Deposit, Withdrawal, and Payment services. Never let the client self-credit or self-confirm a MiniPay deposit.

PROVIDER RULE
Use adapters. Validate signatures/auth. Add idempotency and reconciliation. Do not invent provider behavior.

DAIMO RULE
Keep deposit/Hurry and automatic withdrawal flows separate. Do not hard-code unsupported asset/network/corridor assumptions. Verify current Daimo capabilities during integration.

GAME RULE
Three.js is presentation. Server is authority. No client-side trust for resources, energy, inventory, progression, or financial rewards.

VERIFICATION
Run relevant unit/integration/E2E/security/financial tests, typecheck, lint, build. Update progress and acceptance status.

STOPPING RULE
When specification and implementation disagree, do not silently override the source of truth. Document the discrepancy and follow the hierarchy.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.

REVIEWS / COMMUNITY AGENT RULE
AI coding agents may implement and test the review/community system but must not be exposed as customer-support agents. Do not implement AI-generated user support replies or AI-authored moderation decisions. Preserve human authorization for moderation and all financial/support operations.


## V7 Admin Rule
AI coding agents may implement Admin Portal code, but they must not introduce AI customer-support agents or bypass human approval controls.
