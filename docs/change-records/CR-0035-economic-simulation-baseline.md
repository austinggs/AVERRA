# CR-0035 - Economic simulation baseline (documentation only)

- **Status:** Complete. Documentation only. No migration applied, no code changed.
- **Date:** 2026-10-07
- **Authorities:** 81_CHANGE_MANAGEMENT.md, 82_SOURCE_INDEX.md,
  71_ARCHITECTURAL_LAWS.md, 48_DATABASE_SCHEMA.txt, 49_API_SPECIFICATION.txt,
  and doc 78 (a discrepancy is never resolved silently).

## Why this change exists at all

A directory `averrra_economic_sim_spec/` (27 files) specifies a virtual-economic life
simulator intended to replace the Mining Game. It was never numbered, never versioned
and never indexed, so per doc 78 it is **input, not baseline** - however detailed it is.

Two things followed from taking it seriously rather than discarding it.

First, the Mining Game had to be classified. It had been in production for months, and
every one of its twenty specification documents (15-34) still carried
`Status: Approved planning baseline`, with no indication anywhere that they were
candidates for retirement. A reader following the authority hierarchy would have built
against all twenty.

Second, the specification's own requirements could not be adopted verbatim. Four of its
central constructs collide with the live database, and adopting them would have
produced migrations that fail against a deployed database rather than documents that
fail review. All are recorded as Q-48 through Q-57 in `docs/DISCREPANCIES.md`.

## What changed

**Two documents added.**

- `AVERRA_FULL_PLAN/88_ECONOMIC_SIMULATION.md` (v1.0) - the authoritative
  economic-simulation roadmap, the three-layer separation, the deterministic
  lazy-on-read market design, the mining retirement path, and the CR-0035..CR-0045
  sequence.
- `AVERRA_FULL_PLAN/89_NUMERIC_AND_MONEY_REPRESENTATION.md` (v1.0) - the authoritative
  typing rules: BIGINT minor units for money and accounting, NUMERIC(38,12) for prices,
  returns and factors, exactly one final rounding step, and the `_minor` naming rule.

**Twenty documents superseded, none deleted.** Documents 15-34 each received a
banner at line 1 and a corrected header:

    Version:  1.0  ->  1.1
    Status:   Approved planning baseline
              ->  SUPERSEDED 2026-10-07 by CR-0035 - retained as history,
                  not an implementation requirement
    Last reviewed:  2026-09-29  ->  2026-10-07

Leaving `Status: Approved planning baseline` in place would have directly contradicted
the banner sitting above it. A superseded document that still advertises itself as the
approved baseline is worse than one that was simply deleted, because the authority
hierarchy routes a reader to it on the strength of that word.

**Eleven documents amended and version-bumped:**

| Document | From | To |
| --- | --- | --- |
| `00_START_HERE.txt` | 1.2 | 1.3 |
| `01_PRODUCT_VISION.txt` | 1.0 | 1.1 |
| `02_PLATFORM_OVERVIEW.txt` | 1.0 | 1.1 |
| `46_ANALYTICS.txt` | 1.1 | 1.2 |
| `47_GAMIFICATION.txt` | 1.0 | 1.1 |
| `48_DATABASE_SCHEMA.txt` | 1.3 | 1.4 |
| `49_API_SPECIFICATION.txt` | 1.2 | 1.3 |
| `66_GAME_TESTING.md` | 1.0 | 1.1 |
| `71_ARCHITECTURAL_LAWS.md` | 1.2 | 1.3 |
| `75_GAME_ECONOMY_FLOW.md` | 1.2 | 1.3 |
| `82_SOURCE_INDEX.md` | 1.3 | 1.4 |

`71` gains **Law 8**, the three-economic-layers rule. `82` is corrected from "the
88-document specification (documents 00-87)" to 90 documents (00-89) and its FILE MAP
now marks 15-34 as superseded.

**Two records updated.** `docs/DISCREPANCIES.md` gains Q-48 through Q-57 plus a note on
the starting-balance encoding; `docs/PROGRESS.md` gains the CR-0035 section.

## The four collisions that would have failed at implementation

These are not wording disagreements. Each would have produced a migration that fails
against the deployed database, or a silent financial-rendering defect.

1. **`app.game_achievements` already exists** (migration `20260930000021`, line 79).
   The specification proposes creating it. Q-54.
2. **The order state `PAID` does not exist.** The live enum `app.paid_order_status`
   is `PENDING, CONFIRMED, FULFILLED, REFUNDED, CANCELLED`. This is the exact defect
   class of CR-0029 / Q-41, where a literal absent from an enum rendered **paid money
   as unpaid** - silently, because nothing throws. Q-55.
3. **`deposit_virtual_cash`** names a virtual mint after a real-money operation.
   In this repository "deposit" means User Funding Balance credited only after
   independent payment verification. Q-56.
4. **Price columns named `*_minor` while required to be fractional.** Across migrations
   040 and 043, `_minor` is unambiguously `BIGINT`. Q-57.

## Mining is dormant, not removed

The Mining Game remains in the codebase, remains reachable in production, holds
player data, and is referenced by the real ledger. Nothing was dropped, renamed,
archived or rewritten, and no mining regression coverage was deleted.

Retirement is four ordered stages - **dormant**, **dependencies re-pointed**,
**production absence verified**, **final retirement** - and CR-0045 is the only
destructive change record. CR-0036 (mining-data audit) remains a hard prerequisite to
Stage 4. Retirement was deliberately not scheduled or estimated here: the audit has not
run, so any estimate would be a guess presented as a plan.

## What this change did NOT do

- No migration created, edited or applied. The applied-migrations-freeze rule was
  trivially satisfied because nothing under `supabase/` was touched.
- No table, column, enum or function created or altered.
- No code change in `src/` or `tests/`.
- No endpoint, route, UI, feature flag or configuration change.
- No mining data touched.
- No mining document deleted. The specification was amended through this change
  record, per doc 81, rather than edited ad hoc.

## Validation actually performed

| Check | Result |
| --- | --- |
| SUPERSEDED banners present in 15-34 | 20/20 |
| Header correction applied to 15-34 | 20/20 (Version 1.0->1.1, Status, Last reviewed) |
| UTF-8 integrity of edited files | intact; em-dash preserved |
| Non-documentation files changed | none |
| Migrations changed | none |
| `82_SOURCE_INDEX.md` document count | corrected 88->90 |

**There is no documentation linter in this repository.** `npm run` exposes `dev`,
`build`, `lint`, `typecheck`, `test`, `e2e`, `check:bundle`, `check:migrations`,
`check:data-api` and `check:grants`; none validates prose, and no `format:check`
script exists. The existing gates are code gates. They were used to prove that no code
changed - not to validate the documents, and they would report "ok" on prose that is
wrong. Reference and consistency checking here was manual: every `88`/`89` cross
reference was checked to resolve, and every collision recorded above was verified
against the migrations rather than against the specification's own description.

## Open assumption to confirm at CR-0037

The Q-57 naming conflict was resolved in favour of the required **type**, with the
column **name** giving: `_minor` remains reserved for `BIGINT` minor-unit amounts, and
price columns take `_price` / `_price_num` / `_rate` / `_factor`. This was the
recommended option (a) and it is recorded in `89` section 4, but it was not separately
ruled on before being written down. The alternative - making all prices `BIGINT` minor
units - was rejected because it cannot represent the specification's own one-kobo coin
price with usable precision. Flagged rather than silently adopted.

## AMENDMENT CR-0035A — sequence correction (documentation only)

- **Status:** Complete. Documentation only. Still no code, migration, schema, test,
  UI, API, configuration or mining-data change.
- **Date:** 2026-10-07
- **Approved CR-0035 baseline:** commit `13456ec5ada5df652f6b4f40c6c77cbd3de5bbec`
- **Trigger:** explicit owner instruction to make the implementation sequence below
  authoritative and internally consistent.

### Why the sequence was reordered

Two changes of substance, ordered by risk and prerequisite rather than by how
visible a feature is.

1. **The store moved CR-0042 -> CR-0044.** It is the only surface touching the
   real-money order, product, entitlement and payment-submission machinery from
   CR-0017, and the only one carrying the provisional-earnings projection. At
   CR-0042 it would have gone into production before the virtual economy it sells
   into existed.
2. **Player-to-player trades and the marketplace moved CR-0044 -> CR-0042.** They
   are pure Layer-1 virtual mechanics whose prerequisites (assets CR-0038,
   trading CR-0040) are complete by CR-0042, and they touch no real-money surface.
   Bundling them with navigation behind the roadmap's highest-risk work held
   low-risk work for no benefit.

A third consequence: the previous ordering placed navigation re-pointing in
CR-0044 on the assumption that something would exist to point at. It may now be
included only once the replacement surfaces are ready, because re-pointing
navigation earlier leaves users with a dead link — a production regression, not a
retirement.

### Corrected sequence

    CR-0036  Mining-data audit and dependency inventory. STRICTLY READ-ONLY,
             and the FIRST step.
    CR-0037  Economic-simulation foundation. First IMPLEMENTATION.
    CR-0038  Asset catalogue and seasons. No live market simulation yet.
    CR-0039  Deterministic market engine.
    CR-0040  Trading.
    CR-0041  Fictional crypto. No real blockchain custody.
    CR-0042  Player-to-player trades and marketplace.
    CR-0043  Jobs and life economy.
    CR-0044  Store and governed reward / UI integration, generalizing CR-0017.
    CR-0045  Final mining retirement. The ONLY destructive CR.

Per-CR scope is authoritative in `88_ECONOMIC_SIMULATION.md` section 8. This
change record carries the summary only, so the two cannot drift on scope.

### Consistency repairs required by the reorder

Sections 6 and 7 of `88` named CR numbers that section 8 moved. They were updated
in the same change, which is the point: a document whose own sections disagree is
worse than one that is merely incomplete.

| Location | Was | Now |
| --- | --- | --- |
| `88` §6 | CR-0042 generalizes the paid-perks system | CR-0044 |
| `88` §7 | "the existing mining-data audit" | CR-0036 named, plus four explicit CR-0045 preconditions |
| `88` §10 | "Implementation begins at CR-0036" | CR-0036 is the first step and implements nothing; CR-0037 is the first implementation |
| `88` header | Version 1.0 | Version 1.1, with an AMENDMENT CR-0035A block |

### Not changed

Sections 1-5, 9 and 10 of `88`; every architectural law; the three-layer
separation; the BIGINT and NUMERIC typing rules in `89`; the four retirement stages;
and the rule that CR-0036 is read-only and first. **No substantive CR-0035 design
was altered.**

### Known inconsistency left in place, deliberately

`docs/DISCREPANCIES.md` Q-53 and Q-55 still attribute the store and the
`paid_order_status` enum mapping to CR-0042. Both are now CR-0044. This correction
was scoped to `88` and to this change record, so the discrepancy file was left
untouched rather than edited outside its authorised scope. **It should be
corrected to CR-0044 before CR-0044 is implemented**, or a future implementer will
read a decision that no longer matches the roadmap.

### Validation actually performed

| Check | Result |
| --- | --- |
| `88` §8 sequence matches the instructed sequence | yes, all 10 entries |
| CR-0036 first and marked read-only | yes |
| No substantive CR-0035 design altered | yes — sections 1-5, 9, 10 untouched |
| Files changed | `88` and this record only |
| Commit traceability | `13456ec5ada5df652f6b4f40c6c77cbd3de5bbec` recorded in both |
| Code gates | not applicable — no code changed |