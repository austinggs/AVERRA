# CR-0026 - Referral reward funding path and the per-referrer cap

Date: 2026-10-03
Status: APPLIED to migration 052. **Verified live**: 18 suites / 390 assertions /
0 failures. **The programme is still UNFUNDED** - see Outstanding.

## The owner's decisions, implemented exactly

| Decision                                                          | Where                                |
| ----------------------------------------------------------------- | ------------------------------------ |
| Keep `qualification_threshold_minor = 500000`                     | untouched from CR-0025               |
| Keep `referral_reward_minor = 50000`                              | read inside `pay_referral_reward`    |
| Add configurable `maximum_rewards_per_referrer`, initially 100    | seeded in 052                        |
| Keep the signed ledger and net-of-withdrawals                     | **migration 050 is not modified**    |
| Keep no-clawback after QUALIFIED                                  | **not implemented, deliberately**    |
| Prepare the AVERRA_PROMOTIONAL source, require an explicit budget | created inactive with zero budget    |
| Verify `reward_referral()` end-to-end against a funded source     | `supabase/tests/referral_reward.sql` |
| Do not seed `paid_perk_products`                                  | untouched                            |
| Tests for the cap and idempotency                                 | both, plus the unfunded refusal      |
| Do not expose reward config or the ledger to clients              | asserted twice                       |

## NOTHING IS FUNDED

Migration 052 creates the `AVERRA_PROMOTIONAL` reward source with
`budget_total_minor = 0`, `budget_remaining_minor = 0`, `is_active = false`.

That is deliberate and is what "prepared but not funded" means in practice: the
`source_type` is validated by the database, `reward_referral` has something to name,
and `grant_reward` still refuses to pay. The migration cannot commit money even by
accident.

Funding is `fund_promotional_reward_source(p_budget_minor, p_actor_id)`, which takes
the budget as an **explicit parameter**, refuses zero or negative, activates the row,
and writes an `audit_events` row because adding liability to a live programme must
be attributable (law 27). Nothing in a migration supplies the number.

The source is a distinct `source_type` from `PROVIDER` and `ADVERTISER` precisely so
a referral payout can never be drawn from, or mistaken for, a provider budget or user
money (law 56).

## reward_referral (migration 024) IS NOT MODIFIED

The cap lives in a new wrapper, `pay_referral_reward`, that checks policy then
delegates. Two reasons: a re-typed function body is how this repository has corrupted
SQL before, and the cap is a programme policy rather than a change to the reward
mechanic.

Ordering inside the wrapper matters and is deliberate:

1. **Already REWARDED -> return early.** Checked BEFORE the cap, so a retry is a
   no-op rather than a confusing "cap reached" error for a reward that already
   exists.
2. **Resolve the AVERRA_PROMOTIONAL source here**, never from a parameter, so no
   caller can name a different one.
3. **Unit must match the source**, so the amount can never be paid in the wrong
   denomination.
4. **The cap.** Absent means unlimited, which is why the default is 0 rather than
   100: a default would silently impose a limit nobody chose.
5. **The amount from configuration**, never from a caller.

## THE CAP IS COST CONTROL, NOT A JUDGEMENT

Asserted explicitly: a referral blocked by the cap stays **QUALIFIED**, not
REJECTED. The referrer is not suspected of anything; the programme has simply reached
its exposure limit. Raising the cap then lets the same referral pay, which proves
the refusal was the cap and not something unrelated.

## Three defects found in MY OWN TEST by running it

**1. I never called the payout.** The draft funded the programme and then asserted
the referral had become REWARDED - without ever calling `pay_referral_reward`. Five
assertions failed because nothing had paid anything.

**2. I raised the cap and never re-attempted.** The proof that the refusal was the
cap required calling the payout again; re-reading the status was not a test of
anything.

**3. The cap fixture violated a real constraint.** It tried to give one referrer a
second code, which `referral_codes_user_unique` forbids. A cap is about a referrer
having many REFERRALS, not many codes, so the fixture now adds a second referee to
the same referrer.

All three are the same shape: an assertion that looked complete but never exercised
the thing it named.

## Verification

    suites                18/18 executed
    assertions            390, failed 0   (was 362 across 17)
    referral_reward.sql    28/28

    check:migrations    OK - 183 functions, 0 errors
    check:grants        OK - 87 public functions, 0 errors
    check:data-api      OK - 83 app tables, no direct access
    typecheck / lint / test (239) / build    clean

`reward_referral()` had **never executed once** in this project's history. It now
runs end to end against a funded source inside the test transaction: payout,
exactly the configured ₦500, drawn from AVERRA_PROMOTIONAL, budget decremented by
exactly ₦500, second call creating no second reward and no second decrement.

## Outstanding

**The programme remains unfunded.** To open payouts:

```sql
select app_private.fund_promotional_reward_source(50000000, null);  -- ₦500,000
```

`50000000` kobo at ₦500 per reward is 1,000 rewards, matching the owner's stated
maximum. **I have not run this** - it commits real money and the owner chose that
number, not me.

**`paid_perk_products` is still empty**, so the perk-purchase half of the
qualification formula stays inert. The deposit half works. No product or price was
invented.

**No clawback, as decided.** A withdrawal after qualification lowers
`qualified_value_minor`; the status stays QUALIFIED. If stronger anti-fraud economics
are wanted later, the answer is a hold period BEFORE payout.

## Files changed

    supabase/migrations/20260930000052_referral_reward_funding.sql  new (3 functions)
    supabase/tests/referral_reward.sql                              new (28 assertions)
