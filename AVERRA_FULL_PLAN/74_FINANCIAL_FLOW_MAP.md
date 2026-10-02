AVERRA — FINANCIAL FLOW MAP

Document: 74_FINANCIAL_FLOW_MAP.md
Version: 1.2
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines authoritative financial paths and state boundaries.

INBOUND REWARD
Verified economic event → reward liability → pending → available → withdrawal reservation.

MANUAL MINIPAY CRYPTO DEPOSIT
On-chain Celo transfer of allowlisted token → independent verification → duplicate check → admin confirmation → USER_FUNDING_DEPOSIT ledger event → User Funding Balance.

DEPOSIT REVIEW EXCEPTIONS
Wrong token/network, native CELO, underpayment, overpayment, late transfer, unknown transaction, or ambiguous match → NEEDS_REVIEW → admin decision → credit, recovery/return where possible, or rejection → audit.

FUNDING SPEND
User Funding Balance → approved platform purchase → USER_FUNDING_SPEND ledger debit → game/paid-perk entitlement.

WITHDRAWAL WITH SERVICE FEE
Earned reward balance → withdrawal request → gross amount validated → 15% Platform Service & Maintenance Fee calculated → fee disclosed → net payout confirmed → reservation/ledger → settlement → reconciliation.

NEVER
No client balance edit, no direct SQL balance mutation without financial service, no deposit credit from a screenshot/link state alone, no silent payment-method fallback, and no conversion of user-funded deposits into earned rewards.
