# CR-0033 - Settlement-gated attribution

- **Status:** Complete. Migrations 059-062 applied and recorded on the live database.
- **Date:** 2026-10-05
- **Authorities:** 08_PROVIDER_INTEGRATION.txt RECONCILIATION and FINANCIAL BOUNDARY,
  35_REWARD_ENGINE.txt, 05_REWARD_ECONOMICS.txt, doc 13 TRACKING, doc 14,
  71_ARCHITECTURAL_LAWS.md laws 4/5/6/10/20/25.

## Why this change exists at all

CPX signs **only the transaction id**:

    hash = md5(trans_id + secure_hash)

`subid_1` is **not covered by the signature**. The signature therefore authenticates
that _someone_ sent us that transaction, and says nothing about _whose_ click it was.
Their `trans_id`s are visibly sequential (`1001228169113`), so they are guessable.

The moment `subid_1` carries a live tracking id, anyone who can guess a `trans_id` can
post a well-formed callback naming any `subid_1` they like, and
`resolve_tracking_user` will faithfully credit that user.

This was inert until now **only because nothing was payable** - `UNRESOLVED_TRACKING_ID`
meant no user was ever resolved. Building script-tag issuance is what activates the path,
which is why the settlement gate had to exist first.

## Defect 1 - `AVAILABLE` was not gated on settlement at all

Migration 015's comment claimed:

> a provider conversion is a liability, not immediately spendable money. It settles via
> transition_reward once settlement is confirmed.

The first sentence was true. The second was a wish. `app_private.transition_reward`
refused only the _reversing_ states and terminal states; it placed **no condition on
`AVAILABLE`**. Any caller holding EXECUTE could move a PENDING provider reward straight
to AVAILABLE, making a value the provider had not paid for withdrawable.

Nothing ever called it that way and the provider was CANDIDATE, so no money was at risk.
That was luck, not a control, and it stopped the moment a provider went LIVE.

### The fix, and why it was a revoke

`transition_reward` is APPLIED, so its body was left byte-identical. Adding a
`p_settlement_id` parameter was rejected for the same reason CR-0032 rejected adding one
to `record_provider_conversion`. The AVAILABLE path is closed from the outside instead,
using the CR-0028 `grant_reward` / `grant_reward_ungated` shape:

- `transition_reward_ungated` carries the original body,
- `transition_reward` refuses `AVAILABLE` unconditionally and forwards everything else,
- EXECUTE on the ungated function is revoked from **every** role including
  `service_role` - a rename carries the original grant with it, so omitting
  `service_role` would have made the gate decorative,
- only `settle_provider_period`, which demands a MATCHED settlement, can reach AVAILABLE.

## Defect 2 - reconciliation was MATCHED-by-absence

`app.provider_settlements` (migration 014) carried `expected_amount_minor` commented
"Computed, not trusted." **Nothing computed it.** Every settlement would have been
recorded as matching trivially.

`reconcile_provider_period` now computes our own expected amount and count from
**CONVERTED** conversions only. Counting `RECEIVED` or `VALIDATED` would report a variance
every time we correctly declined to pay something, and a reconciliation that cries wolf is
one nobody runs. Excluding `REVERSED` is deliberate: that exclusion is what makes a
forged conversion surface as a variance instead of being absorbed.

## Defect 3 - attribution could never resolve

`resolve_tracking_user` had worked correctly since CR-0013 and had **never resolved
anything**, because no migration inserts into `app.provider_participations`.

`begin_provider_participation` mints a 128-bit CSPRNG tracking id, server-side. A client
may never choose one - a client-chosen id is a sequential id by another name, and the
whole property is that it cannot be guessed. That is why it is a command and not a column
the caller writes.

`resolve_tracking_user_for_attribution` adds what the old wrapper lacked: a notion of
liveness. It resolves only while the participation is `STARTED` or `QUALIFIED`.

**Stated honestly: this narrows the live window, it does not authenticate the click.** A
forged `subid_1` naming a real, live tracking id still resolves. Unpredictability raises
the cost; the settlement gate is what actually prevents money leaving.

## Two bugs found while building this

**Migration 060's mint was dead on arrival.** It called `gen_random_bytes(16)` under
`set search_path = app, pg_catalog`. On Supabase, pgcrypto lives in a schema literally
named `extensions`, so the name did not resolve. plpgsql bodies are not validated at
CREATE, so 060 applied cleanly and **every structural gate passed**. Only a pgTAP
assertion that actually invoked the function found it. Migration 062 corrects the
search_path.

**Migration 059 could not record a settlement.** It wrote `currency` from
`(select settlement_currency from app.providers ...)` and that column is NOT NULL. Every
CANDIDATE provider has no `settlement_currency`, so the subquery returned NULL and the
INSERT died - meaning reconciliation was unreachable for exactly the providers it exists
to protect. Migration 061 coalesces to `UNSPECIFIED`. Both are the same class as the
Q-43 enum comparisons: an assumption about configuration this repository deliberately
does not have, which produces a value that is always empty and nothing throws.

Both were corrected **forward** in 061 and 062. Migrations 059 and 060 are applied and
were left byte-identical to what the database received.

## A leak that had been running for a whole release

`supabase/tests/provider_reversal.sql` - added in CR-0032 - declared a trailing
`rollback;` but **no matching `begin;`**. PostgreSQL accepts that as a no-op, so the
suite's entire fixture was **committed to the live database on every green run**. Three
`pgtap-%` conversions had accumulated.

The runner does not wrap suites in a transaction; each suite declares its own. Only the
two newest suites were affected; every pre-existing suite was correctly wrapped. Both now
declare `begin;` and it precedes `plan()`.

Found only because CR-0033's suite checked the conversion table and found rows it did not
put there. A green test run had been writing to production and nobody noticed, which is
the failure mode this note exists for.

## Verification

| Gate                                   | Result                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| `npm run test:db`                      | **21 suites, 472 assertions, 0 failures** (was 20/436) |
| `npm test`                             | 19 files passing                                       |
| `npm run typecheck` / `lint` / `build` | clean                                                  |
| `check:migrations`                     | 203 functions, 0 errors                                |
| `check:grants`                         | 95 public functions, 0 errors                          |
| `check:data-api`                       | 83 tables, no direct access                            |

New suite `supabase/tests/provider_attribution.sql`, 36 assertions.

### Proven by re-injection, twice

Two defects were injected into the **live database** and the suite re-run:

1. `grant execute ... to service_role` on the ungated function - caught by the role
   assertion (`have: 1, want: 0`).
2. The gate reduced to amount-only, dropping the count check - caught by the count
   mismatch assertion, and critically by
   **`a count mismatch leaves the reward PENDING` reporting `have: AVAILABLE`**, which is
   the exact shape of money becoming withdrawable without a matching settlement.

Both restored from migration 061 and the revoke re-applied; 472/472 green re-confirmed.
A green run on correct input is the weaker half of the evidence.

### Two assertions that count their own population

- `the three application roles all still exist` - so the revoke assertion cannot pass
  vacuously if the role list is later narrowed to nothing.
- The revoke assertion excludes `postgres` / `supabase_admin`, which **own** these tables
  and bypass ACL regardless of `rolsuper`. Asserting an owner cannot execute its own
  function would be asserting something PostgreSQL does not promise.

## Nothing was promoted

`cpx_research` is still `CANDIDATE`. **No provider reward source exists.** No gate
timestamps were written. Both are asserted in the suite, because "the migration did not
do more than it said" is a claim worth testing.

## Exit criteria before CPX may go LIVE

1. Attribution cryptographically scoped - **DONE** (059/060/062).
2. Settlement gate implemented - **DONE** (059/061).
3. Forged `subid_1` proven to fail - **DONE** for the never-minted and dead-participation
   cases; a live-id forgery resolves by design and is contained by the gate.
4. Reconciliation proven - **DONE against a fixture**. Not yet proven against a real CPX
   settlement report, which requires their period to close.
5. CPX confirms the meaning of `status=1` - **OUTSTANDING, external**.
6. Only then consider LIVE.

Step 4 has two halves and only one is done. Fixture-level reconciliation is proven; a real
report is not, and that is a wall-clock wait on CPX rather than on engineering.

## Also outstanding

Script-tag issuance and the CPX `createTrackingLink` are **not** in this change. They are
deliberately last, and they should not ship before step 5, because issuance without
written confirmation of `status=1` risks paying an unfinished survey.

## CR-0033b - issuance built, still inert (migrations 063)

Added after the above, as the planned second half.

**What was built.** `public.get_offer_tracking_target` reads the destination from
`offers.tracking_base_url` for an ACTIVE offer of a **LIVE** provider, returning NULL
otherwise. `public.begin_provider_participation` forwards to the mint. The CPX adapter
gained `createTrackingLink`, which puts the tracking id in `subid_1`, and
`POST /api/providers/offers/[id]/click` ties them together.

**It does nothing yet.** `cpx_research` is CANDIDATE, so `get_offer_tracking_target`
returns NULL for every offer and the route answers 404. Building the path is not the same
as enabling it, and that is asserted in `provider_attribution.sql` - including a CONTROL
that the offer exists and is active, so the refusal is provably the LIVE gate rather than
a broken lookup.

**Three things the route will not do**, each asserted in `tests/providers/click-route.test.ts`:

- It never reads a user id from the request body. `p_user_id` is the verified session.
  Injecting the body-user defect fails four tests.
- It never accepts a tracking id from the client. The id comes back from the database
  mint, and a client cannot even supply one - there is no such parameter.
- It creates no reward and touches no balance. Opening a link pays nothing.

**One design decision worth recording.** `TrackingLinkInput.baseUrl` was added so the
adapter reads the destination from OUR offer row. If the caller supplied the URL, a
careless caller could send users anywhere while the participation recorded a real offer,
and the postback would attribute the conversion to that offer. The base URL is
configuration we own.

**Verification.** 21 pgTAP suites / 479 assertions green (was 472). 20 vitest files.
Both halves re-injected and restored: renaming `subid_1` fails three adapter tests;
reading the user id from the body fails four route tests.
