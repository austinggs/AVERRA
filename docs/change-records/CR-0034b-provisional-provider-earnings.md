# CR-0034b — Provisional provider earnings (read-only, non-payable)

Date: 2026-10-07
Migration: `supabase/migrations/20260930000064_provisional_earnings.sql`
Suite: `supabase/tests/provisional.sql` (33 assertions)
Unit tests: `tests/wallet/provisional.test.ts` (11 tests)

## What this is

A display-only read model that shows a user the **estimated** earnings
attributed to them from provider conversions, while no money can move.

It exists because CPX Research is a `CANDIDATE` provider. A real callback lands
as a real `provider_conversions` row, but it can never become money:
`apply_conversion_reward` refuses any provider that is not `LIVE` (migration
015 line 66), and CR-0033's settlement gate refuses to release a reward no
`MATCHED` settlement covers. Without a read model the user sees a conversion
that silently does nothing, and the attribution loop cannot be verified end to
end.

## What it deliberately does not do

No table, no ledger entry, no `grant_reward`, no reward row, no `AVAILABLE`
transition, no outbox payout, no funding source. Migrations 015/034/057/059/060/
061/062/063 are **byte-identical** — verified with `git diff --stat` after the
change. This migration only adds a read wrapper.

`supabase/tests/provisional.sql` asserts the ledger and outbox counts are
unchanged across a read, so "a read is not a write" is enforced rather than
asserted in prose.

## `VALIDATED` is not a payability verdict

A `VALIDATED` conversion is one our **adapter** classified as payable. CPX's
`status=1` semantics are still unconfirmed in writing, so `VALIDATED` means "we
accepted the callback" — not "the provider owes us this and Averra has confirmed
it". The UI says _estimated, pending confirmation_; the comments say
_estimated/potential_; and the payload deliberately carries no `payable`,
`confirmed` or `settled` key, which the suite asserts.

## Four defects found and fixed while building this

### 1. `status <> 'REVERSED'` does not exclude a reversed conversion

The obvious filter is wrong **specifically for a non-LIVE provider**.
`apply_provider_reversal` returns early at migration 057 line 337 when the
original has no reward — and every CPX conversion has `reward_id` null, because
CPX is `CANDIDATE`. In that path nothing updates the original's status, so a
reversed conversion still reads `VALIDATED` **forever**.

A status-based filter would therefore show a CPX clawback to the user as
still-pending estimated earnings. The only reliable signal is the link, so the
function excludes any conversion a reversal points at.

### 2. `typeof row.gross_minor === 'number' ? … : 0n` silently zeroed every row

PostgREST serialises `bigint` as a **string**, because JavaScript numbers cannot
hold the range. The first draft branched on the type and fell through to `0n` for
every real row — so the estimate rendered as zero forever, with no error anywhere.
`toBigInt` now normalises both shapes. Re-injecting it produced 2 named failures,
including `expected 0n to be 999999n`.

### 3. A single cross-currency total

The first draft returned `unit: 'minor'` and summed every conversion into one
number. NGN minor units and USD minor units are not the same quantity, so that
figure corresponds to no real amount — the exact conflation doc 09 and law 56
exist to prevent. The projection is now grouped **by currency** with no combined
total anywhere, asserted by checking the payload never contains `351500`
(`350000 + 1500`). Re-injecting it produced 2 named failures.

### 4. `serializeWallet` dropped the projection entirely

The new field was added to `WalletSummary` but not to `WalletSummaryJson`, so
the API route returned nothing for it. It is now serialised explicitly, and
deliberately **not** through the `shape()` helper used by the two balances,
because that helper produces `reserved`/`available` fields and this projection
must never acquire a spendable shape.

## Presentation

The section sits below both real balances and uses `MoneyState state="pending"`,
which is never brand green — so a green number in this system still unambiguously
means credited money. It has no "Request a withdrawal" affordance, and an empty
projection renders "No estimated earnings yet" rather than `0`, because
"nothing to show" and "you earned nothing" are different claims.

## Tooling notes

Three environment facts cost time and are worth recording:

- **A pgTAP suite must end with `select * from finish();`, not `finish()`.**
  `finish` is a function in the `pgtap` schema, not a keyword, so a bare call
  parses as a column reference and raises a syntax error. The runner reports it
  as a suite-level failure, so this one-word difference is the whole difference
  between green and red. Every other suite already does it this way.
- **`supabase/tests/*.sql` is not Prettier-managed** — `npx prettier` cannot infer
  a parser for `.sql`. Only the TypeScript and Markdown files are formatted.
- **`$Host` is a reserved PowerShell variable** and cannot be reassigned. A
  connection-string builder that uses `$host` silently produces a malformed URL
  that still _appears_ to work for the suites that do not depend on it.

An `insert_line` edit at a stale offset spliced text into the middle of the
fixture's `values` list, truncating an INSERT and orphaning two assertions. The
damage was invisible to a delimiter count and to the assertion regex; it was
found only by executing each statement individually and reporting which one
raised. This is the `insert_line` hazard AGENTS.md warns about, and the general
lesson is that a suite needs a statement-level executor for diagnosis, not just
a whole-suite pass/fail.

## Verification

```
npm run check:migrations   OK - 206 functions, 0 errors
npm run check:grants       OK - 98 public functions, 0 errors
npm run check:data-api     OK - no direct Data API access
npm run typecheck          exit 0
npm run lint               exit 0
npm run build              exit 0
npm run check:bundle       exit 0
npx vitest run             11/11 in tests/wallet
run-db-tests-pooled        23/23 suites, 546 assertions, 0 failed
```

Applied to the hosted database and re-verified there.

The suite asserts this two ways: that the excluded row is absent, **and** that
the premise holds (the original still reads `VALIDATED`, and a reversal really
does point at it). Without the second assertion the first could pass because the
fixture failed to build the condition it claims to test.

Re-injecting the bug produced 6 named failures.
