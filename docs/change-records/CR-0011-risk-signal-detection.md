# CR-0011: Risk signal detection

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 40_FRAUD_ANTI_ABUSE THREAT MODEL + SIGNALS,
54_PRIVACY_DATA_PROTECTION, 71_ARCHITECTURAL_LAWS.md law 42

## The gap this closes

CR-0010 shipped a correct risk gate that was **dormant**: nothing emitted signals,
so no decision ever existed for it to act on. This migration makes it live.

Migration 029: `risk_detector_config`, `hash_observation`, `detect_risk_signals`,
`record_task_signal`.

## Detection is separated from enforcement

This is the design constraint that matters, and it is asserted rather than
asserted-in-a-comment. Doc 40 lists RISK SIGNALS as a category distinct from the
DECISION MODEL, so:

- `detect_risk_signals` inserts into `risk_signals` and **cannot** insert into
  `risk_decisions`. A pgTAP test greps `pg_proc.prosrc` for
  `insert into app.risk_decisions` and requires zero matches.
- Neither the detector nor the hasher can move money, or call
  `record_risk_decision`. Also tested.

So a signal can never _become_ enforcement by accident. Converting one into the
other is a separate, audited act performed by `record_risk_decision`.

## Detection must not block the user

The task start path calls `record_task_signal` after the attempt is recorded, and
the call is **deliberately fire-and-forget**:

- it is not awaited on the user-facing path;
- its errors are caught and logged, never surfaced;
- its return value (a signal count) is never used to fail the request.

Failing a user's legitimate action because a detector tripped would give
detection the power of enforcement, which is precisely the separation doc 40 and
law 42 depend on. Losing an observation is recoverable; refusing a real user is
not.

## Detectors, and why those

Chosen to cover the threats doc 40 actually names, rather than whatever was
convenient to compute:

| Detector              | Covers                         |
| --------------------- | ------------------------------ |
| `DEVICE_CLUSTER`      | multi-accounting, device farms |
| `TASK_VELOCITY`       | reward automation              |
| `GAME_VELOCITY`       | gameplay automation            |
| `WITHDRAWAL_VELOCITY` | withdrawal fraud               |
| `DEPOSIT_VELOCITY`    | deposit abuse                  |

Thresholds live in `risk_detector_config`, not in the function body. Tuning
therefore needs no migration and cannot be changed by editing code that also
moves money. The seeded values are starting points, not validated figures — they
need tuning against real traffic.

## Doc 54 on the hashing path

`hash_observation` uses pgcrypto's `digest(value, 'sha256')` and stores only the
hex digest. The raw identifier is never persisted and is not recoverable from the
hash, because the input is not kept anywhere.

Four tests cover it: determinism (the same input must yield the same hash, or
device correlation silently stops working), difference on distinct inputs, that
the output is not the raw value, and that it is a 64-character hex digest.

pgcrypto is already created in migration 001, so no extension dependency was added.

## Gate status

Typecheck, lint, 143 unit tests, production build, migration structure check
(51 functions), format check and bundle secret scan all pass.

pgTAP is now 173 assertions across ten files, every plan count verified.

## Outstanding

- **No automatic decision policy.** Signals accumulate but nothing converts them
  into `record_risk_decision` calls. That is intentional for now: an automatic
  threshold-to-decision mapping would mean detection effectively enforces, and
  that threshold deserves to be set deliberately rather than inherited from a
  default.
- **No operator UI** to review signals, record a decision, or see a blocked
  reward.
- **No appeals workflow.** `superseded_by_id` is supported; nothing writes it.
- **No signal collection on other paths.** Only task start calls a detector.
  Game actions, withdrawals and deposits have detectors defined but no caller.
- Standing gaps: Three.js viewport, upgrade worker, referral code issuance,
  payment worker, gamification (doc 47), dashboards, runbooks.
- pgTAP unexecuted; migrations unpushed by direction.
