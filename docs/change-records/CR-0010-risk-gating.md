# CR-0010: Risk gating the reward engine

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 40_FRAUD_ANTI_ABUSE FINANCIAL INTEGRITY + DECISION MODEL,
71_ARCHITECTURAL_LAWS.md law 42

## The gap this closes

CR-0009 recorded the most consequential problem in the build: `current_risk_decision`
existed and was correct, but **nothing consulted it**. A `HOLD` recorded intent
without enforcing anything. A policy that no code path reads is not a control.

This migration makes a risk decision actually stop money.

## Wrap, do not rewrite

`grant_reward` is the single most safety-critical function in the codebase.
Re-typing its body to insert a gate would risk a silent transcription difference
in the function that moves real money.

Instead:

```sql
alter function app_private.grant_reward(...) rename to grant_reward_ungated;
```

and a new `grant_reward` wraps it. The gated behaviour is therefore provably the
original behaviour plus a precondition, and the money logic is byte-identical
because it was never touched.

## The bypass I nearly shipped

The rename **carries the original `grant execute ... to service_role` with it.**
So immediately after the rename, `service_role` could call `grant_reward_ungated`
directly and walk straight past the gate. The control would have looked
complete in review and been decorative in production.

The fix is the explicit revoke:

```sql
revoke all on function app_private.grant_reward_ungated(...)
  from public, anon, authenticated, service_role;
```

The wrapper is `SECURITY DEFINER` and owned by the migration owner, so it can
still call the inner function regardless of the caller's grants. Only the wrapper
is exposed.

A pgTAP test asserts `grant_reward_ungated` has no EXECUTE privilege for `anon`,
`authenticated` **or `service_role`**. This is the assertion that makes the gate
real rather than nominal.

## Where the gate sits, and why

Two orderings were deliberate:

- **After the idempotent replay check.** A client retrying a request whose
  response it lost must receive the same reward back, not an error, even if a hold
  has since been applied. A replay is not a new event.
- **Before anything is written.** The refusal happens before the call, so a
  blocked reward leaves _no trace at all_: no ledger entry, no reward row, no
  budget movement, no account.

## Law 42, precisely

Doc 40: risk decisions "may hold or reject future events but must not silently
rewrite financial history."

This gate never reverses, adjusts or claws back an existing reward. It refuses
to create a new one. That distinction is the entire content of the law.

The refusal is not silent, though: it writes `reward.blocked_by_risk` to
`audit_events` with the decision id, reason code, event type and amount, so
support and an appeal can see exactly why a credit did not occur.

## Only ALLOW permits a credit

Doc 40 lists a decision spectrum: ALLOW, HOLD, REVIEW, REJECT, RESTRICT, SUSPEND,
TERMINATE. `reward_blocked_by_risk` treats every value except ALLOW as blocking,
which is the safe reading of a spectrum. It is a `STABLE SQL` function, so it is
a pure read and cannot itself change state.

It also ignores expired decisions, so a user cannot be frozen forever by a stale
record.

## Gate status

Typecheck, lint, 143 unit tests, production build, migration structure check
(48 functions), format check and bundle secret scan all pass.

pgTAP is now 162 assertions across ten files, every plan count verified.

## Outstanding

- **No signal collection.** Nothing emits risk signals, so in practice no
  decision will exist for the gate to act on. The gate is correct but currently
  dormant.
- **No appeals workflow.** `superseded_by_id` is supported; nothing writes it.
- **No operator UI** to record a decision or review a blocked reward.
- The other Phase 9-10 gaps stand: no moderation queue UI, no dashboards, no
  runbooks, and gamification (doc 47) is still absent.
- pgTAP unexecuted; migrations unpushed by direction.
