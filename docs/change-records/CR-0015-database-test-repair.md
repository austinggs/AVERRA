# CR-0015 - The database test suite, executed for the first time

Date: 2026-10-02
Closes: Q-24, Q-25, Q-26, Q-27, Q-28, Q-29, Q-30 in docs/DISCREPANCIES.md
Migrations: 037
Supersedes the "pgTAP remains unexecuted" item in CR-0014.

## Context

The ten pgTAP suites in `supabase/tests/` had never run. `supabase test db` needs
Docker or a linked project, Docker was unavailable on the development machine, and
AGENTS.md recorded the suites as "NOT yet executed". That sentence was the whole
problem: an unrun test is not evidence, and the corpus had drifted.

Every one of the ten suites held at least one defect. Before the repair, a runner
that executed them observed **72 ok, 16 not ok, 4 SQL errors** - and the 4 SQL
errors meant four suites never reached their own `finish()`, so most of the corpus
was not being measured at all. The figures were also misleading in the other
direction: a mid-suite abort discards the TAP already emitted, so 74 further
assertions were invisible. After the runner was corrected, the same database
reported **162 assertions, 16 failed** - the corpus was over twice the size the
first count suggested.

Final state: **10/10 suites, 176 assertions, 0 failures.**

## 1. A runner that needs no Docker (`tools/run-db-tests.mjs`)

Connects to `SUPABASE_DB_URL`, executes each suite, and reproduces pgTAP's output.
`npm run test:db` is now this runner; `npm run test:db:cli` is the canonical
`supabase test db` path.

It is built around the traps this repository has already been caught by:

- **It counts its whole population.** A suite that produces no assertions is a
  FAILURE, not a pass, because `0 bad` out of an empty population is not an
  assurance. That is the same rule Q-22 produced, applied to tests instead of
  grants.
- **It asserts `ok + not ok == plan`.** Judging a suite by the absence of `not ok`
  lines is how Q-28 hid - a suite that aborted emitted no line at all and looked
  clean.
- **One connection per suite.** Each suite is `begin; ... rollback;`; an error
  aborts its transaction, so ten suites on one connection turn one real failure into
  ten and hide which suite is broken.
- **TAP is collected per statement.** node-postgres returns every result set for a
  multi-statement batch - but only when the batch SUCCEEDS. Collecting per statement
  preserves the assertions that ran, so a suite with one bad statement reports
  `ok 13/13` alongside the error instead of reporting nothing.

### The runner was proven to fail

A check that has never been shown to fail proves nothing, which is a standing rule
here after `checkOutParameterReturns` reported `ok` on the defect it was written for.
Three defects were injected into `supabase/tests/rewards.sql` and then removed, with
the file restored byte-identically:

| injected defect                      | required evidence                            | observed |
| ------------------------------------ | -------------------------------------------- | -------- |
| one failing assertion, plan adjusted | exit 1, `1 failed assertion(s)`              | yes      |
| a suite with no assertions           | exit 1, `produced no assertions at all`      | yes      |
| a SQL error mid-suite                | exit 1, `SQL error`, earlier TAP still shown | yes      |

`--verify-split` additionally runs every suite both statement-by-statement and as one
batch and asserts the TAP is identical. It is, across all ten.

## 2. Two pgTAP properties that made 17 assertions unreachable

### `throws_ok` compares the message by EXACT equality (Q-24)

`throws_ok(sql, errcode, errmsg, desc)` requires `SQLERRM = errmsg` character for
character. It is not a pattern match. Measured against the deployed extension:
errcode-only passes, the full message passes, the constraint name alone fails, and
`.*constraint_name.*` fails too - so it is equality, not an escaping accident.

Fourteen assertions passed a bare constraint name and could never have passed.

The shortcut of passing `null` for the message was rejected deliberately. It passes,
but nearly every check here raises `23514` and a table carries several, so an errcode
alone is satisfied by the WRONG constraint on the same table. All 14 now carry the
full message, which keeps the constraint name that identifies the rule.

Writing the full message exposed two assertions testing the wrong rule entirely:
`tasks.sql` test 6 and `risk_moderation.sql` test 10 each had a fixture that broke a
different constraint first, so neither had ever exercised the rule it named. Both
fixtures now break exactly one rule.

### Casting an enum label to `text` carries collation C (Q-25)

`pg_enum.enumlabel` is type `name`, collation C. `::text` carries that collation onto
the result, and a `text` literal has the database default (`en_US.UTF-8`), so
`results_eq` refused the comparison outright:

    could not determine which collation to use for string comparison

Three suites aborted on this. Compared as `name[]` instead - the labels genuinely are
names, and `name[]` removes the cast rather than adding a collation override. Measured
four ways, with the shipped form kept as a control to prove the probe detected it.

`is()` tolerates the form `results_eq()` rejects, which is why the vocabulary
assertions written with `is()` had been green all along.

## 3. One live schema defect (Q-26) - migration 037

`campaign_conversions_unverified_not_charged` was INVERTED:

    shipped   check (verified = false or charged_amount_minor = 0)
    correct   check (verified = true  or charged_amount_minor = 0)

As shipped it permitted billing an UNVERIFIED conversion and REFUSED a charge on a
VERIFIED one - the opposite of doc 42 BILLING and of its own comment. The second
effect is the serious one: a legitimate advertiser invoice was unrepresentable, so
the bug would have surfaced as billing that could not be recorded, not as a silent
overcharge.

Found by `growth.sql`, which asserted exactly this rule and had never run. The
assertion was NOT relaxed to match the database: doc 42 outranks migration 025, so
the migration was the bug. Migration 037 corrects it forwards (025 is already
applied, and drop-then-add is idempotent). The row population was counted first - 0
rows, 0 that the corrected rule would reject - so the `alter` could not fail on
existing data, and both cases above were verified live afterwards.

## 4. The rest of the repair

- **`withdrawal.sql` did not parse (Q-28).** A `throws_ok` block had been appended
  after the closing `rollback;` - the same absolute-offset editor defect as Q-11, in
  a test file. Because it asserts a real invariant, the block was restored before
  `finish()` and the plan raised from 20 to 21 rather than deleted. Two further
  defects in that file then became reachable: `split_exact` assertions expecting
  `23505` (unique_violation) for a CHECK constraint, which is `23514`.
- **`risk_moderation.sql` used a double-quoted regex literal (Q-28).** In SQL that is
  an identifier, so the statement failed with `column "decision <> 'ALLOW'" does not
exist` and aborted at test 20 of `plan(33)`. Nothing after it had ever run.
- **Four assertions could not fail (Q-27).** Three selected from an empty
  `app.referral_codes`, so the insert inserted zero rows and `throws_ok` recorded
  "no exception"; one referenced an empty `app.game_missions`, so it died on NOT NULL
  before reaching its rule. Fixed by creating the fixture rows the statement needs,
  including the `auth.users` row that `referral_codes.user_id` requires.
- **One assertion contradicted the spec rather than the code (Q-29).** `game.sql`
  test 6 demanded that no game table reference a funding source, but doc 25 permits a
  mission to carry a funded reward and migration 021 documents that reference as
  never-a-payout. Narrowed to name the single permitted exception rather than relaxed
  to a count, so it still fails if a NEW game table gains a funding path.

## Verification

    database                       live project apdjiraovzersfqpbzhm
    suites                         10/10 executed
    assertions                     176, failed 0
    plans matched                  all 10
    --verify-split                 passing on all 10
    injected-defect proofs         3/3 caught, file restored byte-identical
    npm run check:migrations       OK - 113 functions, 0 errors
    npm run check:grants           OK - 57 public functions, 0 errors
    npm run check:data-api         OK - 70 app tables, no direct access
    npm test                       176 vitest tests, passing
    npm run lint / typecheck       clean, clean
    prettier --check .             clean
    migration drift                37 local files / 37 applied rows, none missing,
                                   none applied-but-unlocal
    live constraint (037)          CHECK (((verified = true) OR (charged_amount_minor = 0)))

CI's `db-tests` job runs `npm run test:db -- --require-db` with the URL passed
through `env:` rather than the command line, so it never reaches the job log.
`--require-db` makes a missing URL fatal, so the job cannot go green having executed
nothing.

The first version of that job gated itself with
`if: ${{ secrets.SUPABASE_DB_URL != '' }}` at the JOB level, which is invalid: the
`secrets` context is not available to `jobs.<job_id>.if`, and GitHub rejects the whole
workflow file rather than treating the condition as false. It would have taken the
`verify` job down with it. The presence test now lives in the step as a shell test that
emits a `::warning` annotation when the secret is absent. See Q-30; it is a reminder
that nothing in this repository parses `.github/workflows/`, so a green local run says
nothing about that file.

## Outstanding

- **`SUPABASE_SECRET_KEY` and the database password were exposed in conversation and
  must be rotated**, as CR-0014 already recorded. This CR does not change that.
  When they are rotated, the replacement `SUPABASE_DB_URL` (local and CI) must be the
  POOLER form. `.env.local` currently holds the DIRECT form, `db.<ref>.supabase.co`,
  which cannot connect from an IPv4-only host, and `supabase/.temp/pooler-url` holds
  the pooler host but with NO password in it. Neither file alone is usable; a working
  URL is the pooler host plus the password from `.env.local`.

  There is a THIRD credential file, `supabase.md` (gitignored), which lists a publishable
  key and a direct connection string. Its password is a DIFFERENT value from the one in
  `.env.local`, and only the `.env.local` one is live - so copying the URL out of
  `supabase.md` produces a password authentication failure, not a DNS failure, and looks
  like a different problem. Compare the two before debugging, and refresh or delete
  `supabase.md` at the same time as the rotation rather than leaving a stale copy of a
  credential lying around. Verified 2026-10-02: neither `supabase.md` nor `.env.local`
  is tracked by git (`.gitignore` covers both), so this is a plaintext-on-disk exposure,
  not a repository exposure.

  Two consequences worth knowing before debugging anything here:

  - The runner reads only the process environment. Unlike `next dev` it does not load
    `.env.local`, so `npm run test:db` in a fresh shell prints a `SKIP` line and exits 0
    rather than failing. A visible skip is by design, but it does mean a developer can
    believe they ran the suites when they did not.
  - Exporting `.env.local`'s value instead produces `getaddrinfo ENOTFOUND` on all ten
    suites and `RESULT: FAIL` with `assertions run: 0`. Observed, and the loud failure is
    the runner working as designed - it is the `0 assertions` case that must never pass.

- **Migration 037 was applied to the live database WITHOUT a history row (closed).**
  This CR originally claimed 037 was applied and only needed its history row confirmed.
  The check was run, and the row was absent: `supabase_migrations.schema_migrations`
  ended at `20260930000036`, while the live constraint was already the corrected
  expression. So the effect had been applied out of band - a dashboard or direct SQL
  edit does not write the history table - and every statement in this file before this
  paragraph had been verified against a database whose recorded history disagreed with
  its own schema.

  Reconciled with the sanctioned command, `supabase db push`, which reported exactly
  one pending migration (`--dry-run` first). It is idempotent by construction
  (drop-then-add), so re-applying an already-live constraint is a no-op. History now
  reads 37 rows for 37 files, with no drift in either direction.

  The general point, recorded because it has now happened twice in this project: a
  test suite can be entirely green while the applied-migration record is wrong, because
  the suites run against the SCHEMA and never consult the history table. "The test
  passes" and "the migration is recorded as applied" are different claims, and only the
  first one is proved by a green run. Migrations 031-034 were previously never applied
  at all (Q-16); this is the same gap seen from the other side.

- The `supabase_admin` default ACL remains open (Q-23). Unchanged, and still cosmetic
  rather than exploitable: every application function is owned by `postgres`.
