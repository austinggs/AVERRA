AVERRA — ACCEPTANCE CRITERIA

Document: 70_ACCEPTANCE_CRITERIA.md
Version: 1.2
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines definition of done for system capabilities.

UNIVERSAL CRITERIA
Works end-to-end, server authoritative, permissions enforced, failure states handled, idempotent where needed, audit trail present, telemetry emitted, tests pass, documentation aligned.

MANUAL MINIPAY CRYPTO DEPOSIT
1. User can select MiniPay manual crypto deposit.
2. The UI clearly states Celo-only network.
3. The UI lists Averra-configured supported tokens: USDT, USDC, USDm, USAT.
4. Native CELO and unsupported tokens/networks are explicitly rejected/instructed against.
5. Destination address is copyable and represented as a QR code.
6. User can submit “I’ve sent payment” and a transaction hash.
7. Server verifies network, token contract, destination, amount, transaction success, confirmations, and duplicate status independently.
8. Admin confirmation is mandatory before funding credit.
9. Deposit credit posts only to User Funding Balance.
10. Funding balance is separate from earned rewards.
11. Wrong token/network, late, underpaid, overpaid, or ambiguous deposits enter NEEDS_REVIEW.
12. No client operation can self-credit or self-confirm.
13. Every state transition and financial mutation is auditable.
14. The 15% withdrawal fee does not apply to deposits.

CASH LINK
A Cash Link is not treated as settlement merely because it is created, copied, opened, or claimed. Settlement must be verified before final credit/payout completion.

DAIMO
Hurry required; active session has server-provided expiration; one-hour design window enforced/displayed; payment verification required; admin confirmation required; expired/late cases handled by documented review path.

LIMITS
Configured deposit limits, expiry policy, admin SLA, and high-value two-person approval are enforced server-side.

WITHDRAWAL FEE
Eligible withdrawal confirmation shows gross amount, 15% fee, and net payout before confirmation. Fee is separately recorded and reconciled.


SUPPORT ACCEPTANCE
SUPPORT
1. An authenticated user can create, view, reply to, and close/reopen eligible support tickets according to policy.
2. In-app notifications work without a paid third-party notification API.
3. @vipaverra is displayed as the official human support Telegram contact.
4. Support replies are authored by authorized humans; AI-generated customer-support replies are not used.
5. Automated notifications are factual state messages and are distinguishable from human replies.
6. Telegram contact cannot directly authorize financial credits, withdrawals, refunds, or fraud-review exceptions.
7. Support-agent actions and replies are audit logged.
8. Support cases affecting financial operations can be linked to the relevant deposit, withdrawal, payment operation, or ledger records.

REVIEWS & COMMUNITY ACCEPTANCE
1. User can publish a 1–5 star review with text and optional image.
2. Other users can see published reviews and aggregate rating information.
3. Other users can reply with text and optional image.
4. Public review pages clearly distinguish community content from Support.
5. Report flows work for reviews, comments, and media.
6. Human moderators can act on reports and actions are audited.
7. Verified Experience is derived from real qualifying activity and is not an endorsement.
8. Financial rewards are not granted for positive reviews or favorable ratings.
9. Private financial/support evidence is not exposed through public review APIs or media.
10. No AI-generated customer-support reply path exists.
11. RLS and Storage policies prevent unauthorized ownership or moderation actions.
12. Review and comment state is recoverable after refresh without relying on Realtime delivery.


## V7 Admin Criteria
The Admin Portal must enforce granular authorization, human-only support replies, auditable financial operations, dual approval where configured, safe retries, and separation of earned and user-funded balances.
