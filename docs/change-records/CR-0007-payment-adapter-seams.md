# CR-0007: Phase 7 payment adapter seams

Date: 2026-10-01
Status: Implemented; Daimo NOT integrated
Spec authority: 37_WITHDRAWAL_SYSTEM, 38_PAYMENT_OPERATIONS,
71_ARCHITECTURAL_LAWS law 12, law 22, law 40

## What was built

`src/lib/payments/` mirrors the existing provider adapter pattern (law 12) for
the payment side:

- `types.ts` — `PaymentAdapter`, method vocabulary, execution attribution.
- `registry.ts` — explicit registration and an honest availability report.
- `adapters/daimo.ts` — the port implementation, which refuses every call.
- `tests/payments/contract.test.ts` — 15 tests.

The `payment_operations` table already carried `execution_mode`, `provider`,
`provider_reference` and `provider_callback_at`, and the
`payment_operations_attribution_check` constraint already required an automatic
operation to name its adapter and a manual one to name its human. No migration
was needed; the seam was missing, not the schema.

## Law 40 is structural, and that was the design goal

"Automatic Daimo never silently falls back to a manual method."

Three things enforce it:

1. **`PaymentAdapter` has no fallback member.** No `manualFallback`, no
   `tryAlternate`, no optional method. The absence is the guarantee.
2. **The method-to-adapter table omits manual methods entirely.**
   `ADAPTER_FOR_METHOD` maps only `CRYPTO_AUTOMATIC_DAIMO`. There is no lookup
   that could return a manual handler for an automatic method, because none is
   registered under a manual method's code.
3. **`sendPayoutViaAdapter` throws for a manual method.** A caller reaching for
   an automatic send with a manual method has a bug, and law 22 means a manual
   payout is performed by a person, not by code.

## Why the Daimo adapter cannot send, and why that is correct

Doc 78 forbids inventing provider behaviour. A real adapter must be written
against Daimo's own published documentation, authenticated with real
credentials, and tested in their sandbox. None of that has happened.

So the adapter contains no endpoint, no request format, and no signature scheme.
It refuses every call with an explicit reason. That is the opposite of what a
plausible-looking stub would do, and the difference is the whole point: a
fabricated `ACCEPTED` response would cause the ledger to record a payout that
never happened. There is a test asserting `sendPayout` throws and another
asserting it never returns a provider reference.

## Registration is not availability

The Daimo adapter is registered so the routing seam is genuinely exercised, but
`availabilityFor` still reports unavailable, with the reason stating that the
operation must stay pending for an operator.

This distinction matters. If registration implied availability, the UI could
offer an automatic crypto payout that would fail at the worst possible moment:
after the user has a verified destination and is expecting money. Reporting
unavailable is the honest answer and it costs nothing operationally.

## The net amount, not the gross

`PayoutRequest.amountMinor` is the amount AFTER `quoteWithdrawal` has split the
15% fee. An adapter re-deriving a fee would double-charge the user, so the net
figure is passed across the boundary and the gross is not.

## Gate status

Typecheck, lint, 143 unit tests (up from 128), production build, migration
structure check (41 functions), format check and bundle secret scan all pass.

## Outstanding

- **Daimo is not integrated.** Requires vendor documentation, credentials and
  sandbox testing. Until then `CRYPTO_AUTOMATIC_DAIMO` cannot execute.
- **MiniPay Cash Link is not implemented at all.** Doc 38 calls it "a separately
  approved flow"; there is no inbound adapter for it.
- **No inbound Daimo deposit adapter.** `DAIMO_CRYPTO_DEPOSIT` is in the
  vocabulary but unimplemented.
- **No payment worker.** Nothing calls `sendPayoutViaAdapter`; the outbox
  processor does not drive payouts yet.
- **No admin payment-operations UI.** Operators can see `payment_operations`
  through the service client only.
- pgTAP still unexecuted (119 assertions, eight files); migrations unpushed by
  direction.
