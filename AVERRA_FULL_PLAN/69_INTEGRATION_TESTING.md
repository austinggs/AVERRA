AVERRA — AVERRA — INTEGRATION TESTING

Document: 69_INTEGRATION_TESTING.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Cross-system tests spanning providers, reward, wallet, game, referrals, fraud, admin, notifications, and payments.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

PROVIDER → REWARD
Offer/survey callback validates → conversion stored → Reward Engine creates pending ledger event → available transition → wallet reflects correct amount.

GAME → REWARD
Authoritative mission completion → fraud gate → Reward Engine → wallet history.

REFERRAL → REWARD
Qualified referral → anti-abuse checks → Reward Engine → pending/available reward.

WITHDRAWAL → PAYMENT
Wallet eligibility → withdrawal reservation → payment operation → external confirmation → completed state and reconciliation.

DAIMO HURRY
User request → admin notification → session creation → expiry countdown → payment event → settlement → ledger credit and audit.

SUPPORT/ADMIN
User opens support ticket linked to a transaction; authorized operator reviews evidence without directly bypassing accounting rules.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.

REVIEWS / COMMUNITY INTEGRATION
Test: qualifying Averra event → Verified Experience lookup → review publication → public display; review reply → notification event; report → moderation queue → human moderator action → public visibility change; image upload → Storage object → metadata record → public/private access policy; and support ticket linkage without exposing private records.
