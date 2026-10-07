# CR-0037 — The settlement maturity gate

- **Date:** 2026-10-10
- **Migration:** `supabase/migrations/20260930000066_settlement_maturity_gate.sql` (new, NOT an edit to 059/061 — both are applied)
- **Tests:** `supabase/tests/provider_attribution.sql`, plan 43 → 47
- **Status:** implemented and locally verified; **NOT applied to any database.** Requires `SUPABASE_DB_URL` and `npm run test:db`.

## What prompted it

Research into CPX Research publisher behaviour established something this repository
had only ever recorded as an open question: `status=1` does not mean the provider will
pay. It means CPX logged the completion locally. The **advertiser**, not CPX, decides
validity, and CPX's publisher terms give the advertiser a **60 to 90 day window** to
retroactively devalidate it.

The `status=1` ambiguity was therefore not a UI wording problem. It described a
settlement cycle that outlives ours.

## The defect

`settle_provider_period` is the only reachable path from a conversion to an
`AVAILABLE` reward (CR-0033). It checked exactly one property of the period:

```sql
if p_period_end <= p_period_start then  -- 059, line 321. That was the only check.
```

Nothing required the period to be old. Four existing behaviours then compose into a
silent loss:

| # | Fact | Location |
|---|------|----------|
| 1 | `post_ledger_entry` raises rather than let a user-facing balance go negative | `004` line 124 |
| 2 | Reserving a withdrawal DEBITS `EARNED_REWARD` — so the balance hits zero | `007` line 13 |
| 3 | `reverse_reward` reverses a reward by DEBITING `EARNED_REWARD` in full | `010` line 308 |
| 4 | No maturity check on settlement | `059` line 321 |

```
Day 0    survey completed, status=1, reward PENDING
Day 7    operator settles a week-old period; reward AVAILABLE
Day 8    user withdraws; EARNED_REWARD debited to 0
Day 75   advertiser devalidates; CPX re-notifies status=-2 on the SAME trans_id
         -> reverse_reward DEBITS EARNED_REWARD
         -> balance would be -NGN 500 -> post_ledger_entry RAISES
         -> transaction aborts; nothing is reversed
```

`evidence.ts` catches the error and records `REVERSAL_APPLY_FAILED` against the
callback, so it is *visible* — but **CPX's dashboard shows the clawback as
delivered, and the money is gone.**

I grepped every migration and `src/` for `debt`, `recovery`, `overdraft`, `write_off`:
**zero hits.** There is no mechanism to recover a reversal that arrives after
withdrawal, so this is a permanent loss rather than a deferred one.

### Why this was not caught

Every reversal test in the corpus reverses a reward that is still `PENDING` and still
holding its balance. That is the only case that works. It is also the case least
likely to occur in production once a provider settles on any cadence at all.

## The fix

```sql
if p_period_end > now() - interval '90 days' then
  raise exception 'settle_provider_period: period_end is inside the 90-day maturity window'
```

Anchored on **`p_period_end`, not `p_period_start`** — `p_period_end` bounds the
*youngest* conversion in the period. A period that ended 91 days ago has had 91 days
of advertiser exposure; one that *started* 91 days ago has not.

Deliberately **not configurable**: no parameter, no provider column, no settings row.
A tunable window is a defect one `UPDATE` from returning. This mirrors the existing
reasoning on `AVAILABLE` in `transition_reward` — no parameter exists that could wave
it through, because there is no parameter at all.

Placed **before** reconciliation, so a refused report writes no settlement row, no
audit event and no transition. The operator retries; nothing has to be undone. The
assertion at `provider_attribution.sql` checks the absence of the row, because a row
written on refusal would collide with `(provider_id, provider_reference)` on the
retry and leave an operator believing the period was settled.

`reconcile_provider_period` is deliberately left ungated — reporting on an immature
period is how an operator investigates one.

## The cost, stated plainly

**Users wait ~90 days longer to be paid.** That is what CPX's network costs in time,
and it delays the first settlement for any new provider by the same period. This is a
real product cost and it was chosen over the alternative: paying users and being
unable to take the money back.

## Test changes

`provider_attribution.sql`'s fixture period was `now() - 1 day` → `now() + 1 day`,
which the gate refuses outright. Both the period **and** the fixture conversion's
`created_at` are backdated (200/100/150 days), because reconciliation selects by
`created_at` — without this the suite would have measured the maturity gate instead
of the reconciliation gate.

Four assertions added, with a **control arm**: the identical report is accepted at
100 days and refused at 89, so the gate cannot pass on a function that refuses every
period. The control uses 4999/1 and asserts `VARIANCE`, proving maturity did not
weaken the `MATCHED` gate.

## Verification

- `check:migrations` OK (209 functions) — this gate **caught a real corruption** I
  introduced mid-edit, an orphaned function tail split by a stale `insert_line`
  offset, and reported `unbalanced if/end if (8 if, 6 end if)`
- `check:grants` OK (100 public functions)
- 066's function body diffed against 061: **the only additions are the 15 maturity
  lines.** No existing line of logic changed.
- typecheck, lint, 397 unit tests pass

## Not done

- `npm run test:db` — needs `SUPABASE_DB_URL`
- Migration not applied. `docs/DISCREPANCIES.md` Q-60 records the drift.