AVERRA — AVERRA — SYSTEM DEPENDENCY MAP

Document: 72_SYSTEM_DEPENDENCY_MAP.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Maps internal and external dependencies.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

CORE GRAPH
Identity → all user-facing systems
Provider adapters → Offers/Surveys/Conversions → Reward Engine
Tasks/Game/Referrals → Reward Engine
Reward Engine → Wallet Ledger
Wallet Ledger → Withdrawal Engine
Withdrawal Engine → Payment Operations
Payment Operations → MiniPay/Bank/Daimo
Fraud → Earning/Reward/Withdrawal/Game/Admin
Operations → Providers/Payments/Support/Audit
Analytics ← all domains

DEPENDENCY RULE
Downstream systems may consume upstream events but may not violate upstream authority. Provider/Daimo integrations are external adapters.

FAILURE ISOLATION
A provider outage should not corrupt the core ledger; payment-provider outage should not erase withdrawal requests; analytics outage must not block financial correctness.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.

REVIEWS / COMMUNITY DEPENDENCIES
Identity → Reviews/Comments
Qualifying platform events → Verified Experience service → Reviews
Reviews/Comments → Notifications
Reviews/Comments/Media → Moderation
Supabase PostgreSQL → Reviews/Comments/Reports/Audit metadata
Supabase Storage → Review/comment media
Vercel → Web application delivery

The review system may consume event references from finance/game/support for verification, but it may not mutate those domains.
