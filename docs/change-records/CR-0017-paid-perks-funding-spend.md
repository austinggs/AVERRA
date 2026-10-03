# CR-0017 - Paid perks, donations and the funding-spend path (doc 83)

Date: 2026-10-03
Status: APPLIED to migrations 040-041 and supabase/tests/perks.sql. Database
execution verified live. API routes and UI are NOT part of this change record.

## What prompted this

CR-0016 audited the specification corpus against the implementation and named
three unbuilt subsystems. Reviews (doc 86) shipped as CR-0016. This is the
second, and the one that moves money:

    Paid perks / donations (doc 83)   ABSENT - paid_perk_orders,
                                      paid_entitlements, donations,
                                      user_funding_accounts and
                                      user_funding_balances all missing, and
                                      USER_FUNDING_SPEND was declared in
                                      app.ledger_source_type but used NOWHERE
    Mining Game Three.js shell (doc 17)  still absent

An enum member that exists and is never written is not a harmless leftover. It is
an invitation: it names a money path the schema does not implement, and the first
person to reach for it will build whatever they assume it does.

## What was built

### Migration 040 - paid_perks_foundation.sql

Four enums (`paid_perk_kind`, `paid_order_status`, `paid_entitlement_status`,
`funding_spend_purpose`) and five tables: `paid_perk_products`,
`paid_perk_orders`, `paid_entitlements`, `donations`, `funding_spend_events`.
RLS enabled on all five, nothing granted to `anon` or `authenticated`.

### Migration 041 - funding_spend_commands.sql

Four `app_private` commands, three same-signature `public` entry points (the
migration-035 pattern, because PostgREST resolves an RPC only against an exposed
schema) and three `public` read wrappers. 10 functions.

### supabase/tests/perks.sql

35 assertions. `npm run test:db` is green across 12 suites / 248 assertions.

## The boundaries this enforces, and how

**A purchase can never become an earned reward.** Nothing in this subsystem
references `app.rewards`, `app.reward_sources`, `app.withdrawal_requests` or the
`EARNED_REWARD` domain, and the only money writer posts a `USER_FUNDING_SPEND`
`DEBIT` against the `USER_FUNDING` account. A DEBIT can only reduce a funding
balance. Asserted three ways: no table carries a foreign key to a reward, budget,
withdrawal or fee table; the debit's prosrc names `'''USER_FUNDING_SPEND'''` and
the `USER_FUNDING` domain; and it never names `'''REWARD_EARNED'''`.

The last two are anchored on quoted call-shape literals rather than bare words,
because a function's comments discuss the rules it obeys and a regex cannot tell a
mention from an invocation. A bare-word version passes against a body that never
posts anything, which is the same "cannot fail" class this repository has now
found three times.

**A donation is acknowledgement, never a balance.** `app.donations` has no FK to
any ledger, reward, withdrawal, entitlement, order or spend table, and
`record_donation` cannot reach a money primitive - asserted by inspecting
`pg_proc.prosrc` for `post_ledger_entry`, `grant_reward`, `transition_reward`,
`reverse_reward` or `create_withdrawal_request`.

**Refunds are compensating entries.** `refund_funding_spend` posts a new
`CREDIT`, writes a new `funding_spend_events` row with `is_refund = true` and
`refund_of` pointing at the original, revokes the entitlement and marks the order
`REFUNDED`. The original debit is untouched.

**A duplicate purchase is refused before any write.** The active-entitlement
check runs ahead of the debit, so a refused duplicate leaves no ledger entry, no
spend event and no balance movement. Tested by asserting the throw, then by
showing the earlier spend is still the only one.

## Decisions worth recording

**Per-product uniqueness is a pre-debit check, not a constraint.** The unique
index is `uq_paid_entitlements_order_active (order_id) where status='ACTIVE'` -
one active entitlement per ORDER. Uniqueness per (user, product) is enforced by
`purchase_with_funding` before the debit, because a partial unique index on
(user_id, product_id) would have to denormalize the product id onto
`paid_entitlements` to be expressible, and that copy could disagree with the
order. The check is therefore in the command, and it is tested.

**`funding_spend_events` requires exactly one target.** Two CHECK constraints
cooperate: `single_target` requires exactly one of game target, order or donation,
and `purpose_matches_target` requires the purpose to agree with which target is
named. A game purchase cannot silently point at an order.

**`record_donation` takes no money parameter.** A donation funded by User Funding
Balance is a separate audited `funding_spend_events` row with
`purpose = 'DONATION_FROM_FUNDING'` pointing AT the donation. So the donation
record describes the act and the spend record describes the money, and neither
can be forged from the other.

**`GAME_PURCHASE` is wired but empty.** Doc 75's bridge is modelled - the enum
value, the target column and the check all exist - but no game purchase path is
built, because the Mining Game economy (doc 17) is not. Nothing in this change
invents a game purchase.

## Verification

    database                       live project apdjiraovzersfqpbzhm
    migrations applied             040, 041 (rolled-back transaction; APPLIED-OK)
    suites                         12/12 executed
    assertions                     248, failed 0    (was 213 across 11 suites)
    perks.sql                      35/35
    injected-defect proof          grant execute ... to anon on
                                   public.list_perk_products -> exactly assertion
                                   34 failed, by name and number, "have: 1,
                                   want: 0"; restored -> 35/35 again
    injected-defect proof          a stray donation-keyed ledger row -> exactly
                                   assertion 28 failed, "have: 1, want: 0";
                                   restored -> 35/35 again
    npm run check:migrations       OK - 143 functions, 0 errors   (was 133)
    npm run check:grants           OK - 75 public functions, 0 errors   (was 69)
    npm run check:data-api         OK - 81 app tables, no direct access   (was 76)
    npm test                       176 vitest tests, passing

Both injected defects were proven to fail before either was restored, per the
rule this repository has been burned by twice.

## Three defects found while building this

Recorded in docs/DISCREPANCIES.md as Q-33, Q-34 and Q-35.

**1. The grants assertion named one function and so proved nothing.**
`not has_function_privilege('anon', 'public.list_perk_products(...)')` reads like
a security assertion and behaves like one, until a second public function in the
same subsystem ships without its revoke - at which point the check is still green.
This is the "enumerate the population, then filter" rule from Q-22 arriving in a
new place: the check passed on correct input AND would have passed on the Q-22
breach in any of the other five functions. It is now a count over all six, plus an
assertion that the population is six so a predicate matching nothing is visible.
The `authenticated` role is checked the same way; the original only looked at
`anon`.

**2. The test file granted `anon` EXECUTE and left it there.** Two injection runs
were launched in parallel, each of which patched `perks.sql`, ran the suite, and
restored from its own in-memory copy of the original. The second read the file
the first had already modified, so its "original" contained the injected grant,
and restoring it wrote the grant into the committed test file. The database was
never affected - every suite runs `begin; ... rollback;` - but the file said
`grant execute ... to anon` on line 13, and assertion 34 correctly failed on a
clean run afterwards. Two lessons: verify injection restoration byte-for-byte
(the harness did report `RESTORED true`, and the report was true of the wrong
file), and do not run file-mutating harnesses concurrently against one file. It
was a harness defect, not a schema defect, and it is worth writing down because
the symptom - a green suite turning red with no code change - reads exactly like
a real security regression.

**3. Two fixture statements were counted as assertions when they were not.**
`select app_private.get_or_create_account(...) = app_private.get_or_create_account(...)`
and a bare `select ... is not null` produce a result row, not a TAP assertion, so
pgTAP ignored them and the plan was short by exactly the two. They are now
`select ok(...)`. Worth noting because the plan mismatch was the only symptom:
the fixtures were working, the assertions were absent, and a suite that quietly
stops asserting looks identical to one that passes.

## Outstanding

- **API routes and UI are not built.** Doc 83 API SURFACE and the doc 10 paid
  perks UI still need the catalogue read, the purchase endpoint, the donation
  endpoint, the refund endpoint and the entitlement/spend history pages. The
  database layer is the contract for all of them.
- **No recurring billing.** `paid_perk_products.billing_period` and
  `duration_seconds` are modelled because doc 83 SUBSCRIPTIONS requires the
  lifecycle, but nothing renews a subscription. Renewal is a money path and needs
  its own command.
- **Admin refund approval is not modelled.** `refund_funding_spend` takes an
  actor id; whether a refund requires an approval record the way doc 07 does for
  withdrawals is not stated in doc 83, and was not invented here.
- **The Mining Game purchase path (doc 75) is wired but empty**, and
  `review_experience_type` still lacks the `GAME_PURCHASE` value that CR-0016
  deferred to this record. It is not added: the game economy that would justify it
  does not exist, so adding the enum member now would assert a verification the
  database cannot perform.
- **The Three.js shell (doc 17, milestone M5) is still absent.**

## Files changed

    supabase/migrations/20260930000040_paid_perks_foundation.sql   new
    supabase/migrations/20260930000041_funding_spend_commands.sql    new
    supabase/tests/perks.sql                                       new
    docs/DISCREPANCIES.md                                          Q-33, Q-34, Q-35
    docs/change-records/CR-0017-paid-perks-funding-spend.md        new
