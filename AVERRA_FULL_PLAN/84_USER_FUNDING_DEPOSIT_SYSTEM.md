AVERRA — USER FUNDING & DEPOSIT SYSTEM

Document: 84_USER_FUNDING_DEPOSIT_SYSTEM.md
Version: 1.3
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines how users fund Averra through supported payment methods, specifically the detailed Manual MiniPay Crypto Deposit flow, verification/approval controls, the separate User Funding Balance, exception handling, and how funded amounts may be used within the platform.

CORE MODEL
Averra maintains two materially distinct financial concepts:
1. Earned Reward Balance — money the platform owes the user because eligible earning activity was verified.
2. User Funding Balance — confirmed user-funded value available for approved Averra purchases/services.

A confirmed user-funded deposit MUST NOT be represented as an earned reward, investment, stake, return, or purchase of earning rights.

SUPPORTED FUNDING METHODS
This document defines three separate funding paths:
- MANUAL_MINIPAY_CRYPTO — direct on-chain transfer to Averra's configured MiniPay destination.
- MINIPAY_CASH_LINK — transaction-specific Cash Link flow where approved.
- DAIMO_CRYPTO_DEPOSIT — Daimo-managed deposit flow initiated by the required “Hurry” request.

Other payment methods may exist in the broader Averra plan, but this document is the source of truth for these crypto funding paths.

1. MANUAL MINIPAY CRYPTO DEPOSIT

NETWORK
Celo only.

SUPPORTED TOKENS
Averra's planning-tier candidates are (see TOKEN CANDIDACY TIERS below):
- USDT
- USDC
- USDm
- USAT

NOT SUPPORTED
- Native CELO.
- Any token not present in the server-configured active production token set.
- Any network other than Celo for this deposit method.

TOKEN CONFIGURATION
The server MUST maintain an active token configuration containing token symbol, chain ID/network, token contract address, decimals, activation status, and verification metadata. The client must consume this server-provided list and must never invent or hard-code support.

PRODUCTION VERIFICATION CAVEAT
The planning baseline names USDT, USDC, USDm, and USAT. Current public MiniPay documentation should be revalidated before launch, including exact Celo contract addresses and whether MiniPay can currently send/receive each asset. Current public MiniPay FAQ material presently lists USDT, USDC, and cUSD on Celo, so USDm and USAT should remain inactive until their exact support is verified.

USER-FACING WARNING
The deposit screen MUST prominently show:
“Unsupported tokens or the wrong network will lead to loss of funds.”

It MUST also instruct the user:
- Double-check that the network is Celo.
- Double-check that the token is one of Averra's currently supported tokens.
- Native CELO is not accepted.
- Crypto transfers may be irreversible.

DESTINATION PRESENTATION
The screen MUST show the Averra MiniPay deposit destination as:
- copyable text;
- QR code using the exact same destination; and
- optional share action where supported by the platform.

USER FLOW
1. User opens Wallet → Deposit.
2. User selects “MiniPay Manual Crypto”.
3. User sees the Celo-only network and active token allowlist.
4. User selects a supported token and enters the intended deposit amount.
5. Server creates a unique deposit_request with PENDING status, reference code, user ID, declared asset, declared amount, destination address, created_at, and expires_at.
6. Server returns the active destination address and QR payload.
7. User sends the selected stablecoin from MiniPay or another compatible wallet to the displayed Celo destination.
8. User taps “I've sent payment”.
9. User submits the transaction hash; screenshot is optional evidence only.
10. Server independently verifies the on-chain transaction.
11. Verified candidates enter VERIFIED but remain non-creditable until admin confirmation.
12. Authorized admin reviews the evidence and selects CONFIRM, REJECT, or NEEDS_REVIEW.
13. On CONFIRM, the financial service creates the immutable USER_FUNDING_DEPOSIT ledger event and updates User Funding Balance.
14. The user sees CONFIRMED and the funding becomes available for approved platform purchases.

DEPOSIT STATES
PENDING → SUBMITTED → VERIFIED → CONFIRMED.
Review/terminal states:
REJECTED, EXPIRED, NEEDS_REVIEW, CANCELLED.

A deposit is creditable only in CONFIRMED.

MATCHING DEPOSITS TO USERS ON A SHARED ADDRESS
Recommended design: a combination, not a single mechanism.

Use:
- Averra deposit request ID/reference for off-chain correlation.
- Registered/supplied sender address when available as a matching signal.
- Exact destination address.
- Active token contract.
- Exact base-unit transfer quantity.
- Request creation/expiry time window.
- Transaction hash.
- Token Transfer event/log index where available.

The off-chain reference does not need to be embedded into a Celo token transfer. A shared destination address is acceptable only because the system performs independent transaction/event matching and admin confirmation.

EXACT-AMOUNT RULE
Exact amount should be the default automatic matching signal. Do not use amount alone as proof of ownership. Two users can intentionally send the same amount; tx/event identity and request context are required.

SENDER ADDRESS
Allow the user to pre-register or submit the expected sender address for additional matching and fraud controls. A mismatch does not automatically mean fraud; it creates a review signal.

DUPLICATE PROTECTION
The same verified transfer event MUST NOT be claimed twice.

Preferred uniqueness key:
chain/network + token contract + transaction hash + transfer-event/log reference.

A transaction hash alone is not always sufficient because a single transaction may contain multiple token transfer events.

WRONG TOKEN / WRONG NETWORK
Any unsupported token or wrong network is immediately non-creditable and enters NEEDS_REVIEW.

Recovery policy:
- Do not promise automatic recovery.
- Do not automatically credit.
- Attempt return only when the asset is technically recoverable, the destination is under Averra control, the return is legally/operationally permitted, and sufficient evidence exists.
- Prefer returning recoverable funds to the originating address after review.
- Network costs may be handled according to the published recovery/refund policy.
- Some wrong-network or unsupported-token transfers may be permanently unrecoverable.

LATE DEPOSIT
Recommended request expiry: 24 hours after deposit request creation.

After expiry, the request becomes EXPIRED for normal matching/credit. If an on-chain payment arrives later, it must remain reviewable as NEEDS_REVIEW. Expiry never means the funds may be ignored, and late arrival never authorizes automatic credit.

UNDERPAYMENT
Example: request declares 100 USDT, verified transfer is 80 USDT.
→ NEEDS_REVIEW.
→ Do not automatically credit 100 USDT.
→ Admin may reject, request an additional transfer, or approve a partial credit only if the policy explicitly allows it.
→ Any decision is audited.

OVERPAYMENT
Example: request declares 100 USDT, verified transfer is 120 USDT.
→ NEEDS_REVIEW.
→ Do not silently treat the extra 20 USDT as earned reward.
→ Admin policy may either credit the verified total to User Funding Balance or return the excess to the originating address after review.
→ Record the decision and valuation basis.

VALUATION / NGN DISPLAY
The blockchain transfer quantity is authoritative.
If Averra displays NGN or USD equivalents, it must use a recorded valuation snapshot containing rate, source, and timestamp.
The original token amount remains authoritative.
Do not retroactively change the deposit amount because a later exchange rate changed.
Stablecoin depeg or unusual valuation is a review condition rather than an automatic reward event.

DEPOSIT LIMITS
Recommended configurable launch defaults:
- Minimum: 5 USD-equivalent per deposit.
- Maximum: 500 USD-equivalent per deposit.
- Rolling 24-hour user limit: 2,000 USD-equivalent.

These defaults are not immutable and must be reviewed after fraud, liquidity, support, provider, and legal analysis.

ADMIN SLA
Target:
- staffed payment-operations hours: 15 minutes;
- outside staffed hours: within 1 business day.

This is an operations target, not a promise of blockchain confirmation time.

ADMIN PERMISSIONS
Recommended role separation:
- deposit.verify (prepare): inspect and verify evidence, build the review case. No approval right.
- deposit.approve (approve): CONFIRM / REJECT / NEEDS_REVIEW.
- deposit.reconcile (reconcile): reconcile external settlement against internal records.
- system.config.write (configure): configuration and emergency controls, never routine self-approval.
Capability codes are canonical; see the CANONICAL CAPABILITY MATRIX in doc 43. The preparer must never be the approver.

A user/operator who initiated the financial action must not approve their own exception.

TWO-PERSON APPROVAL
Require two distinct authorized approvers for deposits above a configured high-value threshold. The threshold should be configuration-driven and reviewed periodically.

EVIDENCE RETENTION
Retain the minimum evidence necessary for audit, fraud, support, disputes, accounting, and legal obligations: transaction hash, transfer event reference, token/network data, verification result, admin decision, and audit trail. A seven-year target may be used for planning only after legal/accounting review confirms the retention basis.

SCREENSHOT RULE
Screenshots are optional supplemental evidence. They are never sufficient proof of settlement and never authorize credit by themselves.

ADMIN CONFIRMATION RULE
Payment verification and admin confirmation are deliberately separate controls. A VERIFIED state means the server has verified the payment evidence. It does not yet increase User Funding Balance.

2. MINIPAY CASH LINK
Cash Link is transaction-specific. The party sending funds creates the link and the receiving party uses/claims it.

For user → Averra funding:
User creates Cash Link → Averra receives/claims → settlement independently verified → admin confirmation → User Funding Balance credit.

For Averra → user payout:
Approved payout → Averra/operator creates Cash Link → user claims/uses it → settlement verified → payment operation completed.

A created, opened, copied, or claimed Cash Link is not by itself proof of final settlement. Current MiniPay materials advertise Cash Links; exact SDK/API behavior, supported assets, expiration, and integration terms must be revalidated before implementation.

3. DAIMO CRYPTO DEPOSIT
User selects Daimo deposit → enters desired amount → submits “Hurry” → Averra creates operational request → session/address generated → one-hour planning countdown → payment → provider/chain detection → verification → admin confirmation → funding credit.

The one-hour rule is a planning baseline pending implementation verification of exact current provider behavior.

4. USER FUNDING BALANCE
Confirmed deposits credit User Funding Balance only.

Approved uses include:
- Mining Game purchases.
- Machines, upgrades, construction, and paid game functionality.
- Cosmetics and virtual goods.
- Premium themes.
- Convenience features.
- Paid perks/subscriptions.
- Other approved platform purchases/services.

USER FUNDING RESTRICTIONS
User Funding Balance:
- is separate from earned rewards;
- does not automatically become earned reward balance;
- does not create referral rewards;
- does not increase monetary reward rates;
- does not unlock withdrawals merely because a deposit occurred;
- does not bypass fraud controls;
- does not represent a guaranteed return;
- does not become game-resource cash value merely because it was spent in-game.

5. 15% SERVICE/MAINTENANCE FEE
The baseline 15% Platform Service & Maintenance Fee applies to eligible withdrawals, not ordinary deposits.

Before withdrawal confirmation the user sees:
Gross withdrawal
15% Platform Service & Maintenance Fee
Net payout

Example:
₦1,000 gross → ₦150 fee → ₦850 net payout.

The fee is platform revenue intended to support maintenance, infrastructure, security, support, operations, development, administration, and related platform costs. It must be recorded separately from earned reward history.

6. NO FORMAL KYC BASELINE
Formal KYC is not part of this baseline. Manual MiniPay destination verification for withdrawals and admin confirmation for deposits are operational controls, not KYC. Legal/provider-required checks can still apply to particular flows.

7. LEGAL / COMMERCIAL OPEN DECISION
Before production launch, obtain Nigeria-specific legal/accounting review covering:
- whether receiving stablecoins into an Averra-controlled address and crediting an internal User Funding Balance creates regulated payment, stored-value, custody, virtual-asset, exchange, money-transmission, or other obligations;
- whether Averra should use a licensed PSP/VASP/custodial/settlement partner rather than operate the funding rail directly;
- tax/accounting treatment of deposits, funded purchases, refunds, fees, and platform revenue;
- consumer disclosures and complaint handling.

Current CBN materials confirm active regulatory oversight and licensing categories for payment service providers; current SEC materials also document a regulatory pathway for applicable virtual-asset service providers.

8. AUDIT
Audit events required:
- request created;
- destination/token instructions issued;
- tx hash submitted;
- verification attempted/completed;
- mismatch/review generated;
- admin confirm/reject;
- ledger credit;
- refund/recovery decision;
- funding spend/debit;
- reconciliation outcome.

RELATED DOCUMENTS
36_WALLET_LEDGER.txt
37_WITHDRAWAL_SYSTEM.txt
38_PAYMENT_OPERATIONS.txt
48_DATABASE_SCHEMA.txt
49_API_SPECIFICATION.txt
55_NIGERIA_COMPLIANCE.txt
56_FINANCIAL_CONTROLS.txt
70_ACCEPTANCE_CRITERIA.md
71_ARCHITECTURAL_LAWS.md
73_DATA_FLOW_MAP.md
74_FINANCIAL_FLOW_MAP.md
75_GAME_ECONOMY_FLOW.md
83_MONETIZATION_PAID_PERKS.md


SUPPORT / ESCALATION
Deposit users may contact human support through the in-app Support Center or @vipaverra. Support may collect the deposit request ID and transaction hash, but support contact alone never credits User Funding Balance. Payment verification and authorized admin confirmation remain mandatory. Wrong-token, wrong-network, late, underpaid, overpaid, duplicate, or ambiguous cases must use the documented review workflow.


## V7 Admin Integration
Operational administration for this subsystem is defined in `87_ADMIN_PORTAL_EXPANDED.md`.


TOKEN CANDIDACY TIERS
Two distinct concepts, which must never be conflated:
1. planning-tier candidates: USDT, USDC, USDm, USAT. Tokens Averra INTENDS to
   support. They are not automatically accepted.
2. active production token set: the subset currently enabled in server
   configuration with a VERIFIED Celo contract address and decimals.
The client receives ONLY the active production token set. Candidacy is never
presented to users as support. USDm and USAT remain inactive until their exact
Celo contract addresses and current MiniPay send/receive behaviour are verified.
Native CELO is never accepted and is never a candidacy-tier entry.

DEPOSIT-LIMIT VALUATION CONTRACT
Limits are configured in USD-equivalent minor units, but the on-chain quantity
remains token-native and authoritative.
1. The limit checker converts the VERIFIED on-chain quantity using a valuation
   snapshot captured at deposit-request creation - not at verification, not at a
   later date, and never from a client-supplied value.
2. The snapshot records rate, source, timestamp and the tolerance decision.
3. Allowlisted stablecoins default to par (1 token unit = 1 USD) with a
   configurable depeg_tolerance_bps. If the observed rate deviates beyond
   tolerance, the deposit routes to NEEDS_REVIEW instead of auto-verifying.
4. Rolled 24-hour volume counts CONFIRMED USER_FUNDING_DEPOSIT ledger events, not
   deposit requests, so unconfirmed submissions can neither exhaust nor bypass a
   limit.
5. A limit breach never auto-credits and never silently rejects; the decision and
   its valuation basis are audited.