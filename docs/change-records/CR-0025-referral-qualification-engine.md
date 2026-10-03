# CR-0025 - Referral qualification engine (V1)

Date: 2026-10-03
Status: APPLIED to migrations 050 and 051. **Verified live**: 17 suites / 362
assertions / 0 failures.

## What this implements

The V1 proposal, in full, except the reward payout - see Outstanding.

```
eligible qualification amount
  = confirmed deposits + eligible perk purchases - withdrawals
```

Wired to the platform's own transaction records, as the brief demanded: _"use
AVERRA's existing transaction/payment system as the source of truth. Do not create a
separate client-controlled 'qualifying activity' mechanism."_ Nothing in the client
can mark a referral qualified, and no client can read the reward amount.

## How each abuse rule is enforced

| Rule                                 | Mechanism                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| One qualification per referee        | `status` moves ATTRIBUTED -> QUALIFIED once; `qualify_referral` is idempotent               |
| One reward per referee               | `reward_referral` returns early when already REWARDED                                       |
| No self-referral                     | `attribute_referral` raises; the table constraint is the backstop                           |
| Client cannot qualify                | No `public` function reaches the recorder or `qualify_referral` - asserted against `prosrc` |
| Client cannot read the amount        | `system_config` and the ledger revoked from anon/authenticated                              |
| Only verified transactions count     | Deposits contribute `verified_amount_minor`, never `declared_amount_minor`                  |
| Refunded/failed do not count         | `WHEN` clauses fire only on the transition INTO CONFIRMED / COMPLETED                       |
| Duplicate events do not double count | `unique (source_type, source_id)` on the ledger                                             |
| Reward creation idempotent           | `grant_reward` keyed on `referral-reward:<id>`                                              |

## THE SIGNED LEDGER, AND WHY NOT A COUNTER

A running counter cannot answer two of the brief's requirements: that a reversed
transaction stops counting, and that a duplicate event does not count twice. An
append-only ledger with one row per source event answers both, and the running total
on `referrals.qualified_value_minor` is **recomputed from the ledger on every event**
rather than incremented, so a replay or a manual repair cannot drift it.

## DECLARED IS NOT VERIFIED

The fixture declares ₦900,000 and verifies ₦500,000. The contribution is **₦500,000**.
Counting the declared figure would make the whole scheme a self-asserted form - the
same failure law 64 exists to prevent for the Verified Experience badge.

Units are never converted: a threshold in `NGN-kobo` is not met by a USD amount, and
silently converting would mean inventing an exchange rate the system does not have.

## Three defects found by RUNNING the suite

**1. The unit seed was wrong, so NOTHING could ever qualify.** Migration 050 seeded
`referral_qualifying_unit = 'NGN'`, but every funding record in this schema carries
`'NGN-kobo'`. The unit check dropped **every** contribution, so a referral could
accumulate ₦5,000 of valid deposits and still sit at ATTRIBUTED. Migration 051 fixes it.

The check fails CLOSED - a mismatch means nothing counts and nothing pays - which is
the right direction for money. But a filter seeded to a unit no real record uses is a
programme that can never pay, which is the same shape of bug as a permanently closed
feature.

**2. A comment containing a comma inside an argument list broke `check:migrations`.**
The withdrawal trigger explained itself between its arguments:

```sql
    -- net, not gross: the 15% fee is money Averra retained, not money the user took
    -new.net_amount_minor,
```

The gate splits a call on commas, read the comment as two extra arguments, and
reported _"calls record_referral_qualifying_event with 8 argument(s) but declares
5"_. The gate was right about the file and wrong about the cause. The explanation
moved above the call.

**3. The fixture never created a referral.** `record_referral_qualifying_event`
correctly returns immediately when the user has no referral, so every contribution was
a no-op and seven assertions reported `have: NULL` - one uninteresting root cause. A
`CONTROL` assertion now proves the referral exists before accumulation is tested.

Fixture corrections: `deposit_requests` needs `request_reference`,
`destination_address`, `expires_at`; `payout_destinations` has
`account_identifier`, not `destination_identifier`; and one hand-typed uuid was 31
characters instead of 36.

**`composite IS NOT NULL` was wrong for the fourth time today.** It is true only when
_every_ field is non-null, and `app.referrals` has nullable columns. This class now
appears in four suites and deserves a standing rule.

## Verification

    suites                17/17 executed
    assertions            362, failed 0   (was 334 across 16)
    referral_qualification.sql  28/28
    app tables            83 (referral_qualifying_events added)

    check:migrations    OK - 180 functions, 0 errors
    check:grants        OK - 86 public functions, 0 errors
    check:data-api      OK - 83 app tables, no direct access
    typecheck / lint / test (239) / build    clean

The suite proves the whole chain: a SUBMITTED deposit contributes nothing -> CONFIRMED
contributes the verified figure -> the threshold is crossed -> the referral becomes
QUALIFIED automatically -> and **no reward row exists**, because law 10 correctly
refuses to pay without a funded source.

## Outstanding — THE REWARD STILL CANNOT BE PAID

**`app.reward_sources` is empty, and that is law 10 working.** `grant_reward` raises
_"unknown or inactive reward source"_ without a live funded row, which is why
`reward_referral` has never succeeded and why this change record ends at QUALIFIED.

Paying needs one `AVERRA_PROMOTIONAL` source with a real budget. That commits actual
money to the programme, so it is a funding decision and I have not made it:

```sql
insert into app.reward_sources (source_type, name, currency_unit, budget_total_minor, budget_remaining_minor)
values ('AVERRA_PROMOTIONAL', 'Referral programme', 'NGN-kobo', <budget>, <budget>);
```

**`paid_perk_products` is also empty**, so perk purchases cannot happen yet and the
"perk purchases" half of the formula is currently inert. The deposit half works and is
tested end to end.

**`maximum_rewards_per_referrer` is deliberately unset.** Absent means unlimited. A
cap is a fraud-control policy and nobody has chosen one.

**No clawback.** A withdrawal after qualification reduces the running net but does
NOT un-qualify, because reversing a qualification that may already have earned money
would be a financial history rewrite. Doc 39 does not ask for one.

## Files changed

    supabase/migrations/20260930000050_referral_qualification.sql  new (6 functions)
    supabase/migrations/20260930000051_referral_unit_correction.sql new
    supabase/tests/referral_qualification.sql                    new (28 assertions)
