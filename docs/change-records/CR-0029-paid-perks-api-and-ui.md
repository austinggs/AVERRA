# CR-0029 - Paid perks: API, purchase flow and UI

- **Status:** Complete
- **Date:** 2026-10-04
- **Closes:** the application-layer gap named by CR-0017, which shipped the whole
  database contract and left every endpoint and page unwritten.
- **Authorities:** 83_MONETIZATION_PAID_PERKS.md, laws 42, 43, 44, 47, 56, 63.

## The database was already complete

Nothing new was written in SQL. All eight wrappers already existed:
`list_perk_products`, `list_my_perk_orders`, `list_my_entitlements`,
`list_my_funding_spends`, `create_paid_perk_order`, `cancel_paid_perk_order`,
`record_donation`, `refund_funding_spend`, plus `purchase_with_funding`.

This CR is the missing application layer over a finished contract - the same shape as
CR-0027 fixing Q-38, except that here the machinery was never wired to a driver at
all rather than having one that failed.

## What was built

| File                                                   | Role                                           |
| ------------------------------------------------------ | ---------------------------------------------- |
| `src/lib/perks/reads.ts`                               | Typed server-side reads through the wrappers   |
| `src/lib/perks/present.ts`                             | Pure display decisions, unit tested            |
| `src/app/api/perks/route.ts`                           | `GET` catalogue, `POST` create order           |
| `src/app/api/perks/orders/[orderId]/purchase/route.ts` | The only money route                           |
| `src/app/api/perks/orders/[orderId]/cancel/route.ts`   | Abandon an unpaid order                        |
| `src/app/api/donations/route.ts`                       | Record and pay in one call                     |
| `src/components/perks/PerkCatalogue.tsx`               | Two-step purchase UI                           |
| `src/app/(app)/perks/page.tsx`                         | Catalogue, entitlements, orders, spend history |

## Law 47 is the organising idea, and it is enforced structurally

Creating an order moves no money. `POST /api/perks` takes a **product code and no
amount** - there is no field to tamper with. The confirmation step then posts an
**order id and no amount**; the tendered figure is read back from the order the
database priced. `purchase_with_funding` then independently re-reads the order _and_
the product and refuses if any of the three disagree.

Three checks for one number, none of which trusts the client. Measured end to end
against the live database inside a rolled-back transaction: create → `PENDING` at
75,000; purchase → `FULFILLED`, spend `PERK_PURCHASE`, entitlement `ACTIVE`; replayed
idempotency key → the same order.

Cancelling is not refunding, and that is structural: `cancel_paid_perk_order` refuses
anything not `PENDING`, and `paid_perk_orders_cancelled_has_no_spend` requires a
cancelled order to have no ledger entry. `refund_funding_spend` takes an actor and is
capability-gated, so **there is deliberately no user-facing refund route**.

## Q-41 - a presentation word where a database value belonged, three times

This is the finding worth carrying forward.

**First, `paid_order_status` has no `PAID`.** The enum is `PENDING, CONFIRMED,
FULFILLED, REFUNDED, CANCELLED`. The display map had `PAID → brand tone`. Every
genuinely paid order would have missed the map, fallen through to the fail-closed
branch, and rendered **neutral grey reading "status: confirmed"** - paid money
displayed as unpaid. In a codebase where brand green means exclusively credited
money, that is the worst possible failure, and it would have shipped silently,
because the fail-closed branch is _designed_ to catch unknowns and so looked like it
was working.

**Second, the same map invented `PERK_REFUND` as a spend purpose.**
`funding_spend_purpose` has exactly three values; a refund reuses `PERK_PURCHASE` with
`is_refund = true`. Naming a purpose that does not exist implies refunds are a
different kind of transaction, which they are not.

**Third, the purchase route returned a fabricated status.** It first returned `PAID`,
then `CONFIRMED`. Measured against the database, a successful purchase leaves the
order `FULFILLED`. The response now returns **no status at all**, because
`purchase_with_funding` returns a `funding_spend_events` row and not the order, so the
handler never read one. The client `router.refresh()`es and the authoritative status
comes from the server.

These are the same defect that produced CR-0027's `reward.state === 'SETTLED'`, which
is the state CR-0027 itself introduced a mapper for. Three instances in two CRs, all
the same shape: **a word invented in the presentation layer and compared against a
database enum that does not contain it.** The comparison is always false, and the
surrounding fail-closed logic makes it look deliberate.

**The guard.** `ORDER_STATUSES` is exported and pinned to the real enum, and three
tests assert that every real status has an explicit mapping, that `PAID` is absent, and
that the list has exactly five entries. The mapping was then re-injected with `PAID`
and the suite re-run to prove it fails: **2 tests failed, restored, 22/22 pass.** The
file was restored byte-identically.

## Other honesty decisions

**No product is seeded.** `paid_perk_products` is empty and stays empty. A perk is a
commercial decision with a real price, and the empty state says so rather than
showing a placeholder figure nobody approved.

**Nothing renews a subscription.** `billing_period` and `duration_seconds` are
modelled, and there is no scheduler (docs 60/61/62 unstarted) and no recurring-billing
path, because renewal is a money path needing its own authority and idempotency. So
`describeBilling` returns `recurring: false` for every input and explicitly denies the
renewal claim. Tested across MONTHLY, YEARLY and WEEKLY: the copy must not match
`/renews automatically|billed monthly|auto-renew/i` and must affirmatively contain
"does NOT renew".

**An entitlement is not money.** It has no reward state and is deliberately not mapped
through `MoneyState`; describing a perk in the vocabulary of a pending credit is the
confusion doc 83 STRICT BOUNDARY exists to prevent.

**A refund is a credit.** `is_refund` decides the direction, so a refunded purchase is
never displayed as a second debit. Tested: neither a debit nor a refund may render as
`settled`.

**Amounts are raw minor units**, matching the dashboard, wallet and referrals pages. A
perk is not the one amount in the product formatted differently.

## Input validation tightened at the edge

`paid_perk_products_code_shape` is `^[a-z0-9_]{2,60}$`. The route schema was
`min(2).max(64)`, which accepted uppercase and a four-character overflow that the
database rejects with a raw 23514. It now matches the constraint exactly. Path
segments are validated as UUIDs rather than cast, so a non-UUID is a clean "not found"
instead of a database error.

## Verification

- **19/19 pgTAP suites, 414 assertions, 0 failures**
- **267 Vitest tests, 15 files** (was 245/14; +22 for the perk presentation layer)
- The purchase flow was executed against the live database inside a rolled-back
  transaction and every step's real return shape confirmed
- `check:migrations` 189 fns, `check:grants` 91 public fns, `check:data-api` 83
  tables, `check:bundle` clean
- typecheck, lint, build, `prettier --check` clean

## Still open

- `paid_perk_products` is empty, so nothing can be bought until real products and
  prices are supplied. The whole path is proven; the catalogue is the only missing
  input.
- No subscription renewal, and no scheduler to drive it.
- Refunds are an operator action through `refund_funding_spend`; there is no admin UI
  for it yet, and no user-facing route by design.
