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

## Sequence handed to CR-0036

CR-0036 mining-data audit and dependency inventory (read-only) - CR-0037 economic
domain foundation - CR-0038 assets and seasons - CR-0039 market engine - CR-0040
trading - CR-0041 fictional crypto - CR-0042 store, generalizing CR-0017 rather than
duplicating it - CR-0043 jobs and life - CR-0044 navigation and estimated earnings -
CR-0045 final mining retirement, the only destructive change.