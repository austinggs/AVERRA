AVERRA — MONETIZATION, PAID PERKS & DONATIONS

Document: 83_MONETIZATION_PAID_PERKS.md
Version: 1.2
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines the second monetization model: optional paid perks, non-financial game cosmetics/convenience, ad-free mode, priority support, voluntary donations, and the boundary between optional paid products and user-funded deposits. Deposits or paid products never unlock earning or withdrawal rights solely because the user paid.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

MODEL
Averra remains free to join and earn. Users may optionally purchase non-financial perks. No paid purchase is required to access the normal earning system or withdraw eligible rewards.

PAID PERKS
Examples include:
- Ad-free mode.
- Priority support queue.

PRIORITY SUPPORT BOUNDARY
Priority Support is a queue/response-time entitlement only. It does not guarantee deposit confirmation, withdrawal approval, fraud-review results, refunds, or financial exceptions. Priority Support remains 100% human-operated and does not enable AI-generated support replies.
- Premium visual themes.
- Mining Game cosmetics/skins/animations.
- Non-financial convenience features.
- Non-financial statistics/history enhancements.

STRICT BOUNDARY
Paid perks MUST NOT:
- Increase monetary reward rates.
- Increase withdrawal limits or reduce withdrawal requirements.
- Unlock otherwise unavailable monetary earning opportunities solely because the user paid.
- Multiply referral commissions.
- Bypass fraud/risk controls.
- Convert virtual game resources into cash.
- Guarantee a monetary return.
- Be marketed as an investment, deposit, stake, or profit opportunity.

SUBSCRIPTIONS
If subscriptions are used, store product, price, currency, billing period, entitlement status, start/end timestamps, cancellation state, provider reference, and refund/revocation state. Entitlements are server-authoritative and are independent of the reward ledger.

DONATIONS
A donation is voluntary support for Averra. A donation MUST NOT create a balance, reward, withdrawal entitlement, referral advantage, paid task access, or investment/return expectation. Donation accounting is separate from user reward liabilities.

MINIPAY PAYMENTS
MiniPay may be used for supported paid-perk purchases, donations, and user-funded deposits. Manual crypto deposits use the Celo-only Averra allowlist of USDT, USDC, USDm, and USAT, subject to current provider verification. Native CELO is not accepted by the Averra deposit flow. Deposits are credited only after independent payment verification and authorized admin confirmation.

CASH LINK MODEL
A Cash Link is a transaction-specific payment instrument/reference. The party sending money creates the link; the receiving party uses/claims the link.

If a user pays Averra:
User → creates Cash Link → Averra receives/claims → provider settlement verified → purchase/donation recorded.

If Averra pays a user:
Averra/operator → creates Cash Link → user receives/claims → provider settlement verified → payout operation completed.

A created link, opened link, or copied link is not proof of settlement. Only verified settlement can finalize the financial operation.

MINIPAY ACCOUNT VERIFICATION
Manual MiniPay account/destination verification is required for account-bound MiniPay payout use. This verification confirms operational control/usability of the destination and is not KYC. Deposit confirmation by an authorized admin is a separate payment-operation control. It should record destination reference, reviewer, evidence, status, timestamps, and audit trail while minimizing personal data.

15% PLATFORM SERVICE & MAINTENANCE FEE
Averra charges a baseline 15% Platform Service & Maintenance Fee on eligible withdrawals. The purpose of this fee is to contribute to platform maintenance, infrastructure, security, support, operations, development, administration, and other legitimate operating costs. The fee is platform revenue and is not an investment, tax, deposit charge, or payment for the right to withdraw.

Before an eligible withdrawal is confirmed, the UI MUST show the gross withdrawal amount, the 15% fee amount, and the net amount the user will receive. Example: ₦1,000 gross withdrawal → ₦150 fee → ₦850 net payout. The fee is recorded as a separate financial line item and does not change the user's underlying earned reward history. The fee is not applied to user-funded deposits unless a separate, explicitly approved and disclosed fee policy is added.

USER NOTICE POLICY — 15% FEE
The withdrawal confirmation screen MUST present a clear, prominent notice before the user completes the withdrawal:

“Platform Service & Maintenance Fee: 15% of the gross withdrawal amount. This fee is retained by Averra as platform revenue to support maintaining, operating, securing, supporting, and developing the platform. Your net payout is the gross withdrawal amount minus this fee.”

The interface MUST show the exact currency amount for the fee and the resulting net payout. The same gross/fee/net breakdown SHOULD appear in the withdrawal receipt/history record. Any future change to the percentage or fee basis requires a controlled policy/configuration change and updated user-facing disclosure.

USER-FUNDED DEPOSITS
Averra supports a separate User Funding Balance for confirmed user-funded deposits. Deposits are payment operations, not earnings. Manual MiniPay crypto deposits show the Averra destination address and QR, require Celo plus an active supported-token selection, and require a user-submitted transaction hash followed by independent verification and admin confirmation. A MiniPay deposit remains pending until settlement is independently verified and an authorized admin confirms the deposit. Once confirmed, the corresponding amount is credited to User Funding Balance and may be used for supported Mining Game purchases, virtual goods, paid perks, and other approved platform purchases. User Funding Balance is separate from earned rewards and does not automatically become withdrawable reward balance.

NO FORMAL KYC BASELINE
Averra does not include a general formal KYC workflow in this baseline. This does not override legal, provider, sanctions, AML/CFT, age, fraud, or other mandatory checks that may apply to a particular flow. Any future KYC requirement must be explicitly approved and added to the source of truth.

ENTITLEMENT MODEL
Paid entitlements are represented separately from financial reward balances. A user may have both a reward balance and paid entitlements, but one must never be used as an implicit substitute for the other.

REFUNDS
Refunds revoke or adjust the associated paid entitlement according to the configured policy. Refunds MUST NOT rewrite unrelated reward history.

AUDIT
Purchases, subscription changes, donations, refunds, Cash Link lifecycle events, MiniPay verification decisions, and manual operator actions are auditable.

IMPLEMENTATION NOTES
Exact MiniPay/Cash Link API/SDK behavior, supported assets/networks, fees, expiration rules, and Nigeria availability must be revalidated against current provider documentation during implementation.

RELATED DOCUMENTS
See 03_BUSINESS_MODEL.txt, 04_REVENUE_MODEL.txt, 11_AUTH_IDENTITY_KYC.txt, 37_WITHDRAWAL_SYSTEM.txt, 38_PAYMENT_OPERATIONS.txt, 48_DATABASE_SCHEMA.txt, 49_API_SPECIFICATION.txt, 56_FINANCIAL_CONTROLS.txt, 70_ACCEPTANCE_CRITERIA.md, 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and 84_USER_FUNDING_DEPOSIT_SYSTEM.md.
