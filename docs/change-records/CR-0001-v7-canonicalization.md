# CR-0001 - V7 Canonicalization Patch Set

Document: docs/change-records/CR-0001-v7-canonicalization.md
Date: 2026-09-30
Class: documentation / governance (doc 81 CHANGE MANAGEMENT)
Trigger: AVERRA_V7_AUDIT.md findings F-01..F-05, Q-01..Q-03, R-01..R-03, plus Q-05 found during verification
Authority: doc 71 (Architectural Laws), doc 78 (AI Development Rules), doc 81, doc 82 (authority hierarchy)

## Scope

Documentation only. No runtime behaviour changed, because no runtime existed at the
time of this change. Nothing here alters a financial rule, a state transition, or a
provider contract; it removes contradictions between documents so that one
unambiguous contract exists to implement against.

## Before / after per document

| Document                          | Finding          | Change                                                                                                                                            | Version           |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 00_START_HERE.txt                 | F-01             | Inventory extended with 85, 86, 87.                                                                                                               | 1.1 to 1.2        |
| 00_START_HERE.txt                 | F-04             | The four tokens are no longer described as "the active allowlist"; now a planning allowlist whose runtime active subset is server-configured.     | 1.1 to 1.2        |
| 82_SOURCE_INDEX.md                | F-01, F-05       | "87-document specification" corrected to 88 documents (00-87); FILE MAP extended through 87.                                                      | 1.2 to 1.3        |
| 43_ADMIN_PLATFORM.txt             | F-02, R-03       | RBAC paragraph replaced with capability-based wording; new CANONICAL CAPABILITY MATRIX section added as the single authorization source of truth. | 1.2 to 1.3        |
| 38_PAYMENT_OPERATIONS.txt         | F-02             | ADMIN PERMISSIONS moved from role labels to capability codes. (Doc 38 was a fourth source of the legacy vocabulary that the audit did not list.)  | 1.2 to 1.3        |
| 56_FINANCIAL_CONTROLS.txt         | F-02             | SEGREGATION OF DUTIES moved from role labels to capability codes.                                                                                 | 1.2 to 1.3        |
| 84_USER_FUNDING_DEPOSIT_SYSTEM.md | F-02, F-04, Q-03 | Role block moved to capabilities; token wording split into candidacy tiers; DEPOSIT-LIMIT VALUATION CONTRACT added.                               | 1.2 to 1.3        |
| 37_WITHDRAWAL_SYSTEM.txt          | F-03             | Single STATES list replaced by a three-field model.                                                                                               | 1.2 to 1.3        |
| 87_ADMIN_PORTAL_EXPANDED.md       | F-03, Q-05       | Withdrawal chain mapped onto the three fields; missing Document/Version/Status/Last reviewed header added; canonical roles reconciled.            | header added, 1.0 |
| 11_AUTH_IDENTITY_KYC.txt          | Q-02             | Duplicated sentence removed.                                                                                                                      | 1.2 to 1.3        |
| 85_SUPPORT_AND_CONTACT_POLICY.md  | Q-01             | Metadata normalised to the corpus plain style (it was well-formed, not malformed).                                                                | 1.0 to 1.1        |
| 48_DATABASE_SCHEMA.txt            | F-03, F-04, Q-06 | Canonical withdrawal state fields, deposit token tier tables and domain enum namespacing recorded.                                                | 1.2 to 1.3        |

## Canonical decisions recorded

1. Capabilities are the authorization primitive. Roles are bundles. Capability codes
   are shared identically by SQL guards, RLS, server routes and admin UI.
2. Withdrawal state is three orthogonal fields: withdrawal_status,
   payment_settlement_status, reconciliation_status. APPROVED never means PAID;
   CONFIRMED never means RECONCILED.
3. Reward and withdrawal lifecycles are separate enum types. ELIGIBILITY_CHECKED
   appears in both and must never be merged into one shared enum.
4. Tokens have a planning tier and an active production tier. The client receives
   only the active production tier. Native CELO is never accepted.
5. Deposit limits are enforced against the verified on-chain quantity using a
   valuation snapshot taken at request creation, with a depeg tolerance that
   routes to NEEDS_REVIEW rather than auto-verifying.

## Compatibility

Additive and backward-compatible in intent. No enum value was removed from any
state machine: PAYMENT_INITIATED and COMPLETED (doc 37) and SETTLEMENT and
RECONCILED (doc 87) all survive, the latter two as their own lifecycles.

## Deliberately NOT changed

- AVERRA_V7_AUDIT.md is left byte-identical. It is evidence of what was asserted at
  audit time; corrections live in docs/DISCREPANCIES.md. Rewriting an audit record in
  place would destroy the trail.
- The .txt corpus encoding is left alone. A console-decoding artifact made it look
  like mojibake; the files are valid UTF-8.

## Rollback

Revert the listed files from git history. The pre-patch state is the V7 archive as
received (SHA-256 ff475706506ba3eab63d784283dcf132cb22811077552bb11ba83b05a62d6139).
