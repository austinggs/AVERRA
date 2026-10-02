# AVERRA V7 ZIP AUDIT

## Audit target

- Archive: `AVERRA_FULL_PLAN_COMPLETE_V7.zip`
- SHA-256: `ff475706506ba3eab63d784283dcf132cb22811077552bb11ba83b05a62d6139`
- Extracted specification files: **88**
- Numbered specification range: **00–87**, with no missing numbers
- Audit date: 2026-09-30

## Basis

This audit compares the V7 archive itself with the uploaded implementation/analysis report and checks cross-document consistency inside the archive. The uploaded report describes the repository as greenfield and identifies specification discrepancies that must be change-managed rather than silently resolved.

## What is solid in V7

1. The archive is structurally complete: all documents 00–87 are present.
2. The financial model is consistently centered on a server-authoritative, append-only ledger. User Funding Balance is explicitly separated from Earned Reward Balance.
3. Manual MiniPay deposits are defined as Celo-only, transaction-evidence based, independently verified, admin-confirmed, and non-creditable until `CONFIRMED`.
4. Duplicate protection is event-level rather than tx-hash-only: chain/network + token contract + transaction hash + transfer event/log reference.
5. Wrong token/network, underpayment, overpayment, late payment, and ambiguous matching are routed to review rather than silently credited.
6. The 15% Platform Service & Maintenance Fee is consistently attached to eligible withdrawals, disclosed as gross/fee/net, recorded separately, and excluded from ordinary deposits.
7. Support is consistently human-only, Telegram `@vipaverra` is treated as support intake rather than financial authority, and paid notification infrastructure is not required at launch.
8. Public reviews/community are separated from private support and financial records; review moderation is human-controlled and does not mutate financial history.
9. Supabase is established as the authoritative backend/data platform and Vercel as the web deployment layer.
10. Cash Link settlement is correctly separated from link creation/opening/claiming; settlement verification is required before final credit/payment completion.

## Findings requiring a documentation patch before implementation

### F-01 — Master inventory/index is internally inconsistent
**Severity: BLOCKING for source-of-truth governance**

The archive contains 88 documents, 00–87.

`00_START_HERE.txt` inventories only 00–84 and therefore omits 85, 86, and 87.

`82_SOURCE_INDEX.md` says it is the “87-document specification” and its file map stops at document 85, while separate V7 references identify 86 and 87.

Canonical correction:
- Treat the spec as **88 documents, 00–87**.
- Update `00_START_HERE.txt` inventory through 87.
- Update `82_SOURCE_INDEX.md` count and file map through 87.
- Keep 86 and 87 explicitly indexed rather than only mentioned in a V7 section.

### F-02 — Admin authorization model has multiple competing role vocabularies
**Severity: BLOCKING for authorization implementation**

The following role sets are all present:

`43_ADMIN_PLATFORM.txt` / `56_FINANCIAL_CONTROLS.txt` / `84_USER_FUNDING_DEPOSIT_SYSTEM.md` use:
- `PAYMENT_OPERATOR`
- `DEPOSIT_APPROVER`
- `RECONCILIATION_OPERATOR`
- `SUPPORT_VIEWER`
- `SUPER_ADMIN`

`87_ADMIN_PORTAL_EXPANDED.md` uses a different 14-role vocabulary, including:
- `FINANCE_ADMIN`
- `PAYMENT_OPERATOR`
- `PAYMENT_APPROVER`
- `DEPOSIT_REVIEWER`
- `FRAUD_REVIEWER`
- `SUPPORT_AGENT`
- `SUPPORT_MANAGER`
- `CONTENT_MODERATOR`
- `GAME_ADMIN`
- `PROVIDER_MANAGER`
- `ADVERTISER_MANAGER`
- `ANALYST`
- `AUDITOR`
- `SUPER_ADMIN`

This is more than a list-length difference. The names and responsibilities differ (`DEPOSIT_APPROVER` vs `PAYMENT_APPROVER` vs `DEPOSIT_REVIEWER`, and `RECONCILIATION_OPERATOR` has no direct counterpart in the expanded list).

Canonical correction:
- Create one capability matrix as the authorization source of truth.
- Keep role labels as bundles of capabilities.
- Define exact capabilities for payment preparation, deposit review, deposit approval, reconciliation, withdrawal approval, fraud review, support, moderation, provider administration, analytics, and audit.
- Require the same capability identifiers in SQL/RLS/server guards and admin UI.
- Mark legacy role labels in docs 43/56/84 as aliases only if they are intentionally retained.

### F-03 — Withdrawal state machine differs between core withdrawal and Admin Portal specs
**Severity: BLOCKING for database/API contracts**

`37_WITHDRAWAL_SYSTEM.txt` defines:
`REQUESTED, ELIGIBILITY_CHECKED, RISK_REVIEW, APPROVED, PROCESSING, PAYMENT_INITIATED, CONFIRMED, COMPLETED, FAILED, REJECTED, CANCELLED, EXPIRED`

`87_ADMIN_PORTAL_EXPANDED.md` defines:
`REQUESTED -> ELIGIBILITY_CHECK -> RISK_REVIEW -> APPROVED -> PROCESSING -> SETTLEMENT -> CONFIRMED/FAILED -> RECONCILED`

These are not equivalent enum names. In particular:
- `ELIGIBILITY_CHECKED` vs `ELIGIBILITY_CHECK`
- `PAYMENT_INITIATED` exists only in doc 37
- `SETTLEMENT` exists only in doc 87
- `COMPLETED` exists only in doc 37
- `RECONCILED` exists only in doc 87

Canonical correction:
- Define one withdrawal state machine in a single authoritative contract.
- If operational payment and accounting reconciliation are separate concepts, model them as separate state machines/fields rather than replacing one vocabulary with another.
- Update docs 37, 38, 49, 56, 68, 70, 71, 74, 76, 77, and 87 to use the same state names.

### F-04 — Token “allowlist” versus “active token” semantics are inconsistent
**Severity: BLOCKING for production funding configuration; not an architecture blocker**

`00_START_HERE.txt` describes the **active allowlist** as `USDT, USDC, USDm, USAT`.

`84_USER_FUNDING_DEPOSIT_SYSTEM.md` says the planning baseline names all four but explicitly says **USDm and USAT should remain inactive until exact current support is verified**.

`82_SOURCE_INDEX.md` correctly records the same verification caveat.

Canonical correction:
- Define two concepts: `planning_supported_tokens` and `active_production_tokens`.
- The client must receive only `active_production_tokens`.
- Seed candidate rows for USDm/USAT as inactive until verified.
- Never describe inactive candidates as part of the active allowlist in user-facing or normative text.
- Never invent contract addresses.

### F-05 — `82_SOURCE_INDEX.md` is not actually a complete source index
**Severity: HIGH**

Beyond its incorrect “87-document” count, the FILE MAP omits the V7 additions 86 and 87 even though the same document later references them.

Canonical correction: make the FILE MAP authoritative and complete, including 83, 84, 85, 86, and 87.

## Findings in the uploaded implementation report that do NOT match the V7 archive exactly

### R-01 — The report overstates the extension mismatch in `00_START_HERE.txt`

The report says doc 00 labels every file `.txt` while docs 65–87 are `.md`.

The extracted V7 archive shows that doc 00 correctly labels documents 65–84 as `.md`. The actual defect is that **85–87 are absent from the inventory**.

This should be corrected in the implementation notes so the audit record distinguishes the real defect from the overstated one.

### R-02 — The reported doc 36 numbering typo is not present in the V7 archive

`36_WALLET_LEDGER.txt` correctly numbers its four financial-domain items 1–4.

Therefore this item should be removed from the discrepancy log unless a different version of doc 36 is being audited.

### R-03 — The admin-role issue is broader than two competing lists

The report describes the discrepancy as doc 43’s five roles versus doc 87’s 14 roles.

The archive also contains `DEPOSIT_APPROVER` in docs 43/56/84 and `DEPOSIT_REVIEWER` plus `PAYMENT_APPROVER` in doc 87. The canonicalization work therefore needs to resolve capability semantics, not merely merge two lists.

## Additional quality issues found in V7

### Q-01 — Minor formatting defect in document 85

`85_SUPPORT_AND_CONTACT_POLICY.md` has malformed version metadata (`Version: ** 1.0`). This is cosmetic but should be normalized before treating the corpus as a clean release artifact.

### Q-02 — Duplicate sentence in document 11

`11_AUTH_IDENTITY_KYC.txt` repeats the sentence “This is a payment-operation control, not KYC.” twice consecutively. Cosmetic, but it should be removed in the documentation cleanup pass.

### Q-03 — Deposit-limit valuation basis needs an explicit implementation contract

Deposit limits are expressed as USD-equivalent values (minimum 5, maximum 500, rolling 24-hour 2,000), while the on-chain amount remains token-native. The documents require valuation snapshots for displayed conversions and treat depeg as a review case, but the exact authoritative valuation source/algorithm for **limit enforcement** is not defined.

This should be specified before implementing hard limit enforcement. The requirement can remain configuration-driven; the missing piece is the valuation policy used by the limit checker.

### Q-04 — Financial authority location should be made explicit by ADR

The plan permits trusted server-side application logic or Supabase Edge Functions for privileged operations. The implementation report proposes the stronger hybrid model: Postgres `SECURITY DEFINER` functions for money/state transitions, TypeScript for orchestration and external I/O, plus durable outbox events in the same transaction.

This is a good implementation direction, but it is currently an implementation decision rather than a fully canonicalized source-spec rule. Record it in an ADR before financial code is created so later agents cannot accidentally split authority between routes and functions.

## Audit conclusion

The V7 archive is **substantively coherent and complete enough to serve as the planning baseline**, but it is **not yet clean enough to serve as an implementation-authority corpus without a documentation patch**.

The implementation report is directionally correct about the major blockers, but the archive audit adds two important corrections: the doc-36 numbering defect is not real in V7, and the admin-role discrepancy is wider than the report states.

## Required pre-code patch set

1. Fix `00_START_HERE.txt` inventory to 00–87.
2. Fix `82_SOURCE_INDEX.md` to state 88 documents and map 00–87.
3. Add a canonical capability matrix/ADR for admin authorization; reconcile docs 43, 56, 84, and 87.
4. Canonicalize the withdrawal lifecycle vocabulary across all financial/admin contracts.
5. Normalize token terminology into planning candidates vs active production tokens; keep USDm/USAT inactive until verified.
6. Normalize doc 85 metadata and remove the duplicate sentence in doc 11.
7. Define the USD-equivalent valuation source used for deposit-limit enforcement.
8. Record the chosen financial-authority pattern in an ADR before implementing money mutations.

## Implementation gate after the patch

Only then start Phase 0. The uploaded implementation analysis itself recommends a sequence of Phase 0 foundation → discrepancy resolution → Supabase foundation → review → financial core, with the exit gate covering typecheck, lint, tests, database tests, build, protected-route access, and prevention of secret leakage to the client.
