# CR-0032 - Append-only provider reversals

- **Status:** Complete. Migrations 057 and 058 are applied to the live database.
- **Date:** 2026-10-04
- **Authorities:** 08_PROVIDER_INTEGRATION.txt, 05_REWARD_ECONOMICS.txt,
  71_ARCHITECTURAL_LAWS.md laws 5 (idempotency), 7 (reversals are compensating), 12
  (replaceable integrations), 20 (raw evidence), 42 (no silent financial rewriting).
- **Follows:** CR-0031, which found the defect but deliberately did not fix it.

## The defect

CPX Research re-notifies a transaction when it detects fraud 15-60 days later, using the
**same `trans_id`** with `status=-2`. Their own advisory panel:

> Your postback URL will be called by us a second time, as soon as we cancel a
> transaction. `&status=1` (pending) to `&status=-2` (reversed).

Recorded under the bare `trans_id`, law 5's unique index on
`(provider_id, provider_event_id)` returns the **original** conversion as a `DUPLICATE`.

So a genuine fraud clawback was silently discarded: no reversal row, no
`reverse_conversion` call, no error anywhere - and CPX's dashboard showed the reversal
delivered. This is the **third** instance of that failure family in this integration
(CR-0030's routing, then the amount scale) and the first that would have cost real money.

**Why it is survivable today.** While `cpx_research` is `CANDIDATE` no conversion was ever
converted into a reward, so there was nothing to claw back. The day a provider goes
`LIVE`, this stops being a no-op.

## Why append-only, and not an update

The tempting fix lets the reversal `UPDATE` the original row's status. That is a financial
rewrite: the row that said `VALIDATED` stops saying so, and the record of what the
provider originally asserted is gone (law 42). Law 7 requires a compensating event.

So the reversal creates **its own conversion row**, carrying a distinct event identity,
linked by a new self-referencing column. The original is never rewritten by the _arrival_
of a reversal; it is marked `REVERSED` only by the command that has actually moved the
money.

## Event identity

`trans_id` and `trans_id:-2` are distinct strings, so the unique index admits both. The
suffix keeps the vendor's value verbatim, so `2` and `-2` stay distinct - a numeric
comparison would conflate them, and both are real. Replay safety survives because the
suffix is deterministic: CPX sending `status=-2` twice yields the same id twice, which
the index collapses.

## Two design decisions worth recording

**A separate command, not a parameter.** The first attempt was `create or replace` on
migration 034's `record_provider_conversion` with an appended `p_reverses_event_id`.
`check:migrations` refused the build, correctly:

> migration 035 calls `record_provider_conversion` with 14 argument(s) but migration 057
> declares 15 input parameter(s). This compiles and fails at runtime.

Migration 035 is a `public` PostgREST wrapper passing 14 positional arguments. Adding a
parameter would have compiled and then failed at runtime. So migration 034's function is
left **byte-identical** and `record_provider_reversal_conversion` is additive. The gate
caught this before it shipped, which is the gate earning its place.

**The reversal inherits no user.** A reversal row carries `user_id = null` and
`tracking_id = null`. It withdraws a conversion; it does not attribute a new one, and a
reversal carrying a user id would be a second attribution of the same click.

## An unmatched reversal is recorded, not refused

A vendor may withdraw a transaction whose completion never reached us - a lost callback,
an outage, or a transaction predating this integration. Raising would discard the only
evidence that a withdrawal was offered, which is the exact mistake this migration exists
to prevent. The row is written with a `NULL` link, and `apply_provider_reversal` reports
`no_reward` rather than inventing an original.

## Two bugs this work found in existing code

**A reversal would have been downgraded to `RECEIVED`.** `ingest.ts` computed `p_status`
as `mayConvert ? 'VALIDATED' : 'RECEIVED'`, so a reversal arriving while the provider was
not `LIVE` would be recorded as `RECEIVED` - a live-looking value. The lifecycle gate
governs whether an event may become _money_; it has no business rewriting what the vendor
asserted.

**The clawback would have been skipped on replay.** The reversal handling sits **before**
the duplicate and user-resolution branches, both of which return early. A replayed
reversal is the common case - providers re-notify - so placing it after either branch
would mean the second delivery did nothing.

## Deliberately not gated on the provider's lifecycle

`apply_provider_reversal` runs before `canProduceReward`. A `SUSPENDED` provider pays
nothing out, but it must still be able to claw back money credited while it was `LIVE`.
Gating reversals on `canProduceReward` would mean suspending a provider protects its
payouts - the exact inverse of the intent.

## Verification

| Gate                                   | Result                                             |
| -------------------------------------- | -------------------------------------------------- |
| `npm run test:db`                      | 20 suites, 436 assertions, 0 failures (was 19/414) |
| `npm test`                             | 19 files, 108 tests passing                        |
| `npm run typecheck` / `lint` / `build` | clean                                              |
| `check:migrations`                     | 194 functions, 0 errors                            |
| `check:grants`                         | 94 public functions, 0 errors                      |
| `check:data-api`                       | 83 tables, no direct access                        |

New suite `supabase/tests/provider_reversal.sql` - 22 assertions. The core one is named
`THE CORE ASSERTION: a -2 reversal is NOT discarded as a duplicate of its completion`.

**Both halves were proven by re-injection.** Setting the reversal's event id back to the
bare `trans_id` fails three assertions, the core one reporting `have: true, want: false` -
the duplicate-discard defect reproducing exactly. Reverting the adapter's suffix fails the
adapter-side assertion. Both restored and verified green.

## Not done here

- **No registry promotion.** `cpx_research` stays `CANDIDATE`; all seven doc 07 gate
  timestamps remain null.
- **No reward source.** `provider:cpx_research` does not exist, so nothing can pay.
- **No script-tag issuance or `subid_1` binding.** The live postback carried an empty
  `subid_1`, so no event can resolve a paying user and every conversion lands as evidence
  with `UNRESOLVED_TRACKING_ID`.

## Still blocking `INTEGRATION_TESTING`

CPX contradicts itself about `status=1` - "1 = completed" in their field list,
"`&status=1` (pending)" in the advisory panel. We treat `status=1` + `type=complete` as
payable, so if `1` can mean pending an unfinished survey could be paid. **Needs written
confirmation from CPX.**
