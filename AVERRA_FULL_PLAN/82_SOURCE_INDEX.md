AVERRA — SOURCE INDEX

Document: 82_SOURCE_INDEX.md
Version: 1.3
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Master index of the 88-document specification (documents 00-87) and authority hierarchy.

FILE MAP
00–14 Product/User/Earning foundations; 15–34 Mining Game; 35–47 Reward/Wallet/Payment/Growth; 48–64 Data/Architecture/Security/Operations; 65–82 Testing/Governance/Maps; 83 Monetization/Paid Perks; 84 User Funding & Deposit System; 85 Support & Contact Policy; 86 Reviews & Community System; 87 Admin Portal Expanded.

PRIMARY PROVIDER REFERENCES
- MiniPay homepage: https://minipay.to/
- MiniPay FAQ: https://minipay.to/faq
- MiniPay Cash Links: https://minipay.to/
- MiniPay + Daimo cross-chain deposit: https://minipay.to/blog/minipay-daimo-crosschain-deposit
- MiniPay cross-chain deposit overview: https://minipay.to/blog/cross-chain-deposits-in-minipay
- Daimo payment documentation: https://paydocs.daimo.com/payment-links
- Daimo SDK repository: https://github.com/daimo-eth/sdk

MANUAL MINIPAY CRYPTO BASELINE
Averra's manual MiniPay crypto deposit method is Celo-only and, at the planning baseline, allowlists USDT, USDC, USDm, and USAT. Native CELO is not accepted by Averra's deposit flow. The backend must use an explicit token-contract allowlist and should return the currently active allowlist to the client.

CURRENT PROVIDER VERIFICATION NOTE
As of 2026-09-30, the current public MiniPay FAQ describes Celo stablecoin support including USDT, USDC, and cUSD, while the Averra planning baseline specifies USDT, USDC, USDm, and USAT. Therefore USDm and USAT MUST be treated as configuration candidates that require current in-product/provider verification before production activation. Do not infer support from symbol name alone; verify the exact Celo token contract addresses and current MiniPay sending/receiving behavior.

CASH LINK NOTE
MiniPay currently advertises Cash Links for sending/receiving funds. Exact current SDK/API behavior, expiry semantics, supported assets, and integration terms must be verified from current provider documentation before implementation.

CUSTODY / REGULATORY NOTE
Averra must obtain Nigerian legal/commercial advice before launching a user-funded crypto balance, because receiving or applying user crypto through a platform can raise payment, virtual-asset, custody, money-transmission, consumer-protection, and accounting questions depending on the actual operating structure. CBN maintains oversight/licensing information for payment service providers and the SEC currently oversees applicable virtual-asset regulatory pathways.

DAIMO NOTE
Daimo deposit “Hurry” and one-hour session/address window remain planning requirements pending direct implementation verification. Automatic Daimo withdrawals are a separate operation and do not silently fall back to manual payouts.

FUNDING MODEL NOTE
Confirmed MiniPay deposits post to User Funding Balance only after independent payment verification and authorized admin confirmation. User Funding Balance can fund approved game/platform purchases but does not automatically become earned rewards.

FEE MODEL NOTE
The baseline 15% Platform Service & Maintenance Fee applies to eligible withdrawals, is disclosed before confirmation, and is not applied to ordinary deposits.

AUTHORITY HIERARCHY
Architectural Laws > Approved System Specs > Database/API Contracts > Acceptance Criteria > Implementation Phases/Milestones > Existing Code > Tests > Progress Notes > AI assumptions.

CROSS-REFERENCE RULE
When a requirement appears in multiple files, the more authoritative source controls; duplicated operational descriptions must remain semantically consistent.


SUPPORT POLICY REFERENCE
- `85_SUPPORT_AND_CONTACT_POLICY.md`: official human-only support policy, in-app ticketing, Telegram @vipaverra, low-cost notifications, escalation, priority support, and support audit controls.
- Official Telegram support contact configured by Averra: `@vipaverra`.
- Support email: not configured yet.
- Customer-support AI policy: 0% AI-generated replies in production.

REVIEWS / COMMUNITY REFERENCE
- `86_REVIEWS_COMMUNITY_SYSTEM.md`: public ratings/reviews, threaded community chat, image attachments, Verified Experience, moderation, reporting, Supabase Storage/RLS, and no-AI-support boundary.

HOSTING / BACKEND BASELINE
- Supabase: authoritative PostgreSQL/Auth/Storage/backend service boundary.
- Vercel: intended production web-app hosting/deployment layer.
- Current Supabase breaking-change tracking was reviewed on 2026-09-30; implementation must pin versions and verify current Data API, Node.js, SDK, and CLI behavior before coding.
- Current Supabase documentation states new public-schema tables may require explicit exposure/grants rather than assuming automatic Data API exposure.


## V7
87_ADMIN_PORTAL_EXPANDED.md — detailed Admin Portal operational specification.
