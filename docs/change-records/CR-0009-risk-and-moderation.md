# CR-0009: Phase 9-10 fraud, moderation and operations

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 40_FRAUD_ANTI_ABUSE, 58_CONTENT_MODERATION, 54_PRIVACY,
71_ARCHITECTURAL_LAWS law 41, law 42, law 43

## Migrations 026-027

`risk_signals`, `risk_decisions`, `moderation_items`, plus
`record_risk_decision` and `current_risk_decision`.

## Doc 58 SAFETY BOUNDARY is structural

Doc 58 requires fraud/risk enforcement and content moderation to be "related but
distinct decision systems". They are separate tables with separate enums, separate
reason codes and separate reviewers. A pgTAP test asserts that neither table's
constraints reference the other, so a content takedown can never become a fraud
hold through a shared foreign key.

## Doc 40 FINANCIAL INTEGRITY is verified, not asserted

Doc 40: "Risk decisions may hold or reject future events but must not silently
rewrite financial history."

Two independent checks, both against the deployed database:

1. `pg_proc.prosrc` for `record_risk_decision` and `current_risk_decision` is
   inspected for `post_ledger_entry`, `grant_reward`, `reverse_reward`,
   `transition_reward`, `settle_withdrawal` and `confirm_deposit`. Zero matches.
2. No column on `risk_signals` or `risk_decisions` matches a ledger/balance/
   amount/credited/settled/reversed pattern. There is structurally nowhere for a
   correction to go.

The function also has no parameter through which a caller could request a
correction, so the boundary does not depend on caller discipline.

## Decisions require a reason code

Doc 40 mandates "reason codes and evidence". `record_risk_decision` raises when
the reason is blank, so enforcement is never unexplained and support can always
answer why.

Three further refusals, each for a distinct reason:

- a `USER` decision must name its user, or it would apply to nobody while
  appearing to apply to someone;
- a `TERMINATE` must not carry an expiry, or it would lapse into an implicit
  allow without anyone deciding that;
- `risk_decisions` is append-only, and an appeal is a NEW row linked by
  `superseded_by_id`. The original decision is never edited or removed.

## Doc 54 DATA MINIMISATION

`risk_signals` stores `subject_hash`, never a raw device or network identifier.
A pgTAP test asserts no column named `device_id`, `ip_address`,
`device_fingerprint` or `raw_identifier` exists. A raw identifier is personal
data that serves no purpose once hashed for correlation, and hash correlation
supports every use case doc 40 lists.

## Moderation outcomes require attribution

`moderation_items_reviewed_needs_reason` and
`moderation_items_reviewed_needs_reviewer` mean an approved or blocked item must
carry both. Doc 58 EVIDENCE: an action with no reason and no reviewer is
unauditable.

## Gate status

Typecheck, lint, 143 unit tests, production build, migration structure check
(46 functions), format check and bundle secret scan all pass.

pgTAP is now 153 assertions across ten files, every plan count verified against
its actual assertion count.

## Outstanding

- **No risk-evaluation wiring.** `current_risk_decision` exists and is correct,
  but no grant path consults it. A HOLD currently records intent without
  actually gating a future event, which is the most consequential gap here.
- **No signal collection.** Nothing emits risk signals; there are no detectors
  for multi-accounting, device farms or velocity anomalies.
- **No moderation queue UI.** Items are readable through the service client
  only; there is no reviewer surface.
- **No appeals workflow.** `superseded_by_id` supports it; nothing writes it.
- **No operational dashboards or runbooks.** Phase 10's monitoring, DR and
  incident-drill artifacts are not written.
- **Gamification (doc 47) still absent** from CR-0008 onward.
- pgTAP unexecuted (153 assertions, ten files); migrations unpushed by
  direction.
