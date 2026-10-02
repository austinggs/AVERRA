AVERRA — DATA FLOW MAP

Document: 73_DATA_FLOW_MAP.md
Version: 1.2
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
End-to-end logical data movement, including manual MiniPay crypto deposits.

EARNING FLOW
User → attribution/session → provider/native action → verification event → Reward Engine → earned-reward ledger → wallet/read model.

MANUAL MINIPAY CRYPTO DEPOSIT FLOW
User → create deposit request → server returns Averra MiniPay Celo address + QR + supported token allowlist → user sends USDT/USDC/USDm/USAT → user submits tx hash → chain verification → deposit match/deduplication → admin confirmation → User Funding Balance credit → audit/reconciliation.

DAIMO DEPOSIT FLOW
User → Hurry request → operations → Daimo session/address → payment → provider event/chain settlement → verification → admin confirmation → User Funding Balance credit.

CASH LINK DEPOSIT FLOW
Deposit request → payer creates transaction-specific Cash Link → receiver uses/claims → settlement detected → independent verification → admin confirmation → User Funding Balance credit.

USER FUNDING SPEND FLOW
Confirmed User Funding Balance → purchase authorization → ledger debit → Mining Game/paid-perk entitlement or approved service → audit record.

WITHDRAWAL FLOW
Earned available balance → withdrawal request → eligibility/risk → reservation → 15% service fee calculation/disclosure → payment operation → external settlement → reconciliation → completed.

PRIVACY
Only minimum operational data needed for deposit matching, verification, fraud prevention, reconciliation, support, and legal obligations should be collected.

REVIEWS / COMMUNITY DATA FLOW
User → authenticated review request → server validation → review record → publication state → public review projection.
User → comment/reply → server validation → comment record → thread display → optional in-app notification.
User → image upload → server validation → Supabase Storage object + metadata → moderation/public access policy → public derivative where permitted.
User report → report record → moderation queue → human moderator action → public visibility update + audit event.
Qualifying internal event → server-side verification → Verified Experience indicator only; no public exposure of private financial evidence.
