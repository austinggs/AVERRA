AVERRA — ARCHITECTURAL LAWS

Document: 71_ARCHITECTURAL_LAWS.md
Version: 1.3
Status: Approved planning baseline
Last reviewed: 2026-10-07

AMENDMENT CR-0035 (2026-10-07) - NEW LAW 8
- 88_ECONOMIC_SIMULATION.md and 89_NUMERIC_AND_MONEY_REPRESENTATION.md are added
  as the authoritative requirement for economic simulation.
- Documents 15-34 (Mining Game) are SUPERSEDED and retained verbatim as history.
- Mining is DORMANT and MUST NOT be deleted before CR-0045.

LAW 8 - THE THREE ECONOMIC LAYERS NEVER MERGE
  The virtual game economy, provisional real-money earnings, and governed
  real-money rewards are three separate domains. They MUST NOT be combined,
  summed, netted, or displayed as one figure. Governed real money MUST NOT be
  derived from virtual profit, virtual net worth, virtual asset appreciation, or
  the amount a user paid. There is no conversion rate between virtual wealth and
  real money. Violating this is a financial defect even when every number is
  individually correct.

This CR changed documentation only. No code, schema, migration, test,
configuration, feature flag, UI or API was changed.

PURPOSE
Consolidated non-negotiable system rules.

LAWS
1. No unbacked user funds.
2. Every financial mutation produces an immutable ledger entry.
3. Client-side state never authorizes financial rewards or funding credits.
4. Provider callbacks are authenticated and validated.
5. Provider callbacks are idempotent.
6. Rewards may be pending before becoming withdrawable.
7. Provider reversals are compensating ledger events.
8. No self-completion for personal gain.
9. No fabricated advertising activity.
10. Every reward has a traceable funding source.
11. Manual financial adjustments are audited.
12. Provider integrations are replaceable.
13. User balances derive from authoritative records.
14. Withdrawal state is separate from wallet balance.
15. Fraud controls do not silently alter financial history.
16. Reward claims match configured economics.
17. Frontend is never financial authority.
18. Provider availability is configuration-driven.
19. Use provider-approved sandbox/test methods.
20. Personal data follows minimization and applicable Nigerian requirements.
21. No traditional payment-gateway APIs for manual payouts.
22. Manual withdrawals are actually manual.
23. MiniPay is the planned manual crypto payout method.
24. Bank/direct deposit is the planned manual fiat payout method.
25. Earning-provider APIs/postbacks are permitted.
26. Every withdrawal has an auditable financial record.
27. Manual payment actions are attributable.
28. Payment completion and wallet accounting are separate.
29. Automatic crypto payout may use an approved provider such as Daimo.
30. Daimo capabilities/fees/corridors/compliance/Nigeria availability are verified before implementation.
31. Mining Game is not cryptocurrency mining.
32. Game resources are not inherently money.
33. Mining Game server is authoritative.
34. Analytics are not financial truth.
35. Production changes are controlled.
36. AI agents follow source-of-truth hierarchy.
37. Daimo crypto deposits require a user “Hurry” request.
38. The Averra Daimo deposit design uses a one-hour session/address window, subject to implementation verification of current provider behavior.
39. A Daimo deposit never silently falls back to another deposit method.
40. Automatic Daimo withdrawal never silently falls back to a manual payout method.
41. MiniPay deposits require independent payment verification and authorized admin confirmation before credit.
42. Confirmed user-funded deposits are held in a separate User Funding Balance and are not automatically earned rewards.
43. User Funding Balance may fund approved platform purchases, including Mining Game purchases, virtual goods, and paid perks, but spending it does not create earned cash liability.
44. No client action can self-credit, self-confirm, or directly mutate User Funding Balance.
45. The baseline 15% Platform Service & Maintenance Fee is disclosed before eligible withdrawal confirmation and recorded separately.
46. The 15% service/maintenance fee does not alter monetary reward rates, task economics, withdrawal eligibility, or fraud controls.
47. Manual MiniPay crypto deposits use Celo only.
48. Averra accepts only the configured deposit token allowlist: USDT, USDC, USDm, and USAT; native CELO and all other tokens/networks are unsupported.
49. Unsupported token/network deposits are NEVER automatically credited.
50. A MiniPay deposit requires on-chain/payment evidence; screenshots and copied/opened links are not settlement proof.
51. The same verified blockchain transfer event can be credited at most once.
52. Deposit matching may use shared destination + sender + exact amount + token + request window, but transaction/event identity is the final uniqueness control.
53. Expired deposit requests can be reviewed when late funds arrive; expiry never authorizes automatic credit.
54. User-funded deposits are not investments, stakes, guaranteed returns, or purchases of earning rights.
55. Large deposit confirmations require two-person approval above the configured threshold.
56. Funding-balance spending and earned-reward earning are separate financial domains.


57. Averra customer support is human-operated; AI-generated customer-support replies are prohibited in production.
58. The in-app Support Center/ticketing system is the authoritative support record.
59. @vipaverra is an official human-operated Telegram support contact but cannot authorize financial state changes by itself.
60. Automated notifications may communicate factual system state but must not impersonate human support.
61. Initial support notifications must not require a paid third-party notification API.

REVIEWS / COMMUNITY LAWS
62. Public reviews/comments are separate from private support and financial records.
63. Reviews and comments never directly mutate balances, rewards, deposits, withdrawals, or fraud decisions.
64. Verified Experience means verified underlying platform activity only; it is not Averra endorsement.
65. Averra MUST NOT financially reward positive reviews or condition monetary rewards on favorable sentiment.
66. Customer-support replies are 100% human-authored in production; AI-generated support replies are prohibited.
67. Review moderation decisions remain human-controlled in the initial production system.
68. Uploaded public media must pass server-side validation and deliberate Storage access controls.
69. Public review APIs MUST NOT expose private support, payment, transaction, wallet, or moderation evidence.
70. Supabase PostgreSQL remains the authoritative application datastore and RLS is required for exposed tables.
71. Supabase service-role/secret credentials MUST NOT be exposed to clients.
72. Vercel may host the web application, but hosting does not replace backend/database authorization or financial authority boundaries.


## V7 Admin Laws
1. Admin UI never authorizes a financial mutation by itself.
2. Privileged actions require server-side capability checks.
3. High-risk dual-control actions cannot be self-approved.
4. Support replies are 0% AI-generated.
5. Admin automation retries must be idempotent.
6. Review moderation never alters financial history.
