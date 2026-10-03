# CR-0022 - Paid perk order creation: the purchase path was dead code

Date: 2026-10-03
Status: APPLIED to migration 043 and **verified live**: 14 suites / 298 assertions /
0 failures against the project database.

## What prompted this

Migration 041's `purchase_with_funding` begins its PERK_PURCHASE branch with:

```sql
select * into v_order from app.paid_perk_orders where id = p_order_id for update;
if not found then
  raise exception 'purchase_with_funding: unknown order'
```

and `app.paid_perk_orders` was **never inserted by any migration**. A search across
all 42 migrations returns two references, both `update`: one in the fulfilment
branch of the purchase command, one in the refund command. There is no writer.

So every purchase attempt raised `unknown order` before touching money. The
catalogue was listable, entitlements and spend history were readable, and no
purchase could ever succeed. CR-0017 reported this subsystem as "COMPLETE at the
database level" on the strength of its commands being present and its 35 pgTAP
assertions passing - and those assertions passed because `supabase/tests/perks.sql`
inserted the order row **directly**, bypassing the missing command. The test
fixture covered the gap instead of exposing it.

This is the second instance of the same failure shape in two migrations:
`app.review_comment_media` in 038, `app.paid_perk_orders` in 040. Both were fully
specified, fully constrained, and permanently unreachable. The lesson is recorded
in `docs/DISCREPANCIES.md` as Q-38.

## The one rule that matters

**The price is read from the catalogue, never from the caller.**
`create_paid_perk_order` takes a product CODE and copies `price_minor` and `unit`
off the product row. There is deliberately **no amount parameter**, so there is
nothing for a client to tamper with.

Three independent checks guard that one number:

1. `create_paid_perk_order` copies from the catalogue.
2. `purchase_with_funding` re-reads the order AND re-reads the product, and refuses
   if the two disagree (`order price does not match the product catalogue`).
3. `purchase_with_funding` refuses if the tendered amount differs from the order
   price (`tendered amount does not match the order price`).

None of them trusts the client. The pgTAP suite asserts (1) directly and asserts
that (2) and (3) are reachable by construction.

## What was built

Migration `20260930000043_paid_perk_orders.sql`, 5 functions:

- `app_private.create_paid_perk_order(p_user_id, p_product_code, p_idempotency_key)`
  - idempotent on the key; refuses a retired product; refuses when the user already
    holds an ACTIVE entitlement, BEFORE any row is written
- `app_private.cancel_paid_perk_order(p_user_id, p_order_id)`
  - refuses a FULFILLED or REFUNDED order: cancelling a paid order is a refund,
    not a cancellation, and refunds post a compensating CREDIT (law 42)
- `public.create_paid_perk_order`, `public.cancel_paid_perk_order` - entry points
- `public.list_my_perk_orders` - a read wrapper so the UI can show order state

## Verification

    suites                14/14 executed
    assertions            298, failed 0   (was 274 across 13)
    perk_orders.sql       24/24
    migration 043         applied; the only pending migration

    check:migrations    OK - 159 functions, 0 errors (was 154)
    check:grants        OK - 83 public functions, 0 errors (was 80)
    typecheck / lint / test (239) / build    clean

The suite proves the gap is closed end to end rather than by inspection: it funds a
USER_FUNDING account, creates an order, **pays it**, and asserts the order became
FULFILLED, the ledger entry is a DEBIT against the `USER_FUNDING` domain (never
`EARNED_REWARD`), and an ACTIVE entitlement now exists.

## Three defects found by RUNNING the suite

**1. The purchase assertion returned NULL while looking like a result.** The Q-36
snapshot trap again, in a second file. `purchase_with_funding` inserts the spend
event and updates the order; an outer join in the same statement cannot see
either. Fixed by performing the purchase in its own statement and reading it in the
next, with the spend captured in a temporary table between them. This is now a
recurring rule: **any assertion whose value is produced by the statement testing it
is vacuous.**

**2. The refund-versus-cancel rule was tested against the wrong order.** The
"a paid order cannot be cancelled" assertion cancelled an order that was merely
CANCELLED, so it exercised the idempotent path and expected a refund error. It
passed for the wrong reason. Moved to after the purchase, where it cancels a
genuinely FULFILLED order.

**3. A duplicated block survived an edit.** A replacement left the original
purchase assertion in place, and it still referenced `o.status` on
`app.funding_spend_events`, which has no such column - aborting the suite five
assertions short. Found by grepping for the alias rather than by reading.

The plan count was wrong three times across this file (16, 22, 25) because each was
estimated. It is now counted mechanically, and the comment records that guessing
is what made it wrong.

## Outstanding

- **No API route or UI yet.** This change record covers the database layer. The
  catalogue, purchase, donation, refund, entitlement and spend-history routes, and
  the paid-perks UI, are still to be built against this contract.
- **No recurring billing.** `billing_period` and `duration_seconds` are modelled
  and nothing renews a subscription. That is a money path and needs its own
  change record.
- `supabase/tests/perks.sql` still inserts `paid_perk_orders` directly. It passes
  and it is not wrong, but it now duplicates a command that exists.

## Files changed

    supabase/migrations/20260930000043_paid_perk_orders.sql   new (5 functions)
    supabase/tests/perk_orders.sql                           new (24 assertions)
    tools/run-db-tests-pooled.mjs                            DNS preflight
