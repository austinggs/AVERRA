# Averra - Discrepancy Log

Document: docs/DISCREPANCIES.md
Last reviewed: 2026-09-30
Purpose: record where the source-of-truth corpus disagreed, what was decided, and what
was retracted. Per doc 78, a discrepancy is never resolved silently.

## How these were verified

Every entry below was checked against the files themselves with line-level evidence,
not against memory and not against a prior summary.

## Confirmed and resolved (see CR-0001)

| ID   | Finding                                                             | Evidence                                                                               | Status                          |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| F-01 | Doc 00 inventory ended at 84; docs 85-87 existed but were unlisted. | Inventory tail read as `84. ...`; 85/86/87 present on disk.                            | RESOLVED                        |
| F-02 | Competing admin role vocabularies.                                  | Legacy labels in 38:86, 43:18, 56:35, 84:171-174; doc 87 used a different 14-role set. | RESOLVED via capability model   |
| F-03 | Withdrawal state machine differed between doc 37 and doc 87.        | 37:27 vs 87:87, non-equivalent tokens.                                                 | RESOLVED via three fields       |
| F-04 | "Active allowlist" vs "planning allowlist" contradiction.           | 00:36 said active; 84:32/40 and 82:27 said planning/candidates.                        | RESOLVED via tiers              |
| F-05 | Doc 82 FILE MAP incomplete.                                         | 82:12 mapped 00-85 while 82:58/68 referenced 86/87.                                    | RESOLVED                        |
| Q-02 | Duplicated sentence in doc 11.                                      | 11:27 repeated "This is a payment-operation control, not KYC."                         | RESOLVED                        |
| Q-03 | Limit-enforcement valuation basis undefined.                        | 84 enforced USD-equivalent limits against token-native amounts with no rate source.    | RESOLVED via valuation contract |
| Q-04 | Financial authority location ambiguous.                             | Doc 50 allowed server logic OR Edge Functions.                                         | RESOLVED via ADR-0001           |

## Added during verification (not in the original audit)

| ID   | Finding                                                           | Evidence                                                                                                                                                                                                                    | Status                            |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Q-05 | Doc 87 had no Document/Version/Status/Last reviewed block at all. | 87:1-3 jumped straight to a title and `## Purpose`; the version sweep returned a Version line for every file 00-86 except 87.                                                                                               | RESOLVED                          |
| Q-06 | Doc 38 was a fourth source of the legacy role vocabulary.         | 38:86. The audit's F-02 listed only 43/56/84.                                                                                                                                                                               | RESOLVED                          |
| Q-07 | The audit's F-03 correction was over-broad.                       | Conflicting state names appear as state names only in 37:27 and 87:87. The other nine listed docs use "settlement"/"reconciled" as ordinary prose that was already correct. Mass-editing them would have broken valid text. | CORRECTED: 2 files edited, not 11 |

## Retracted findings - the audit was right and this report was wrong

| ID   | Claim                                                         | Verdict                                                                                                |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R-01 | That doc 00 labelled every file `.txt` while 65-87 are `.md`. | RETRACTED. Doc 00 correctly labels 65-84 as `.md`. The only real defect was the 85-87 omission (F-01). |
| R-02 | That doc 36 had a numbering typo in FINANCIAL DOMAINS.        | RETRACTED. 36:19-22 numbers all four items 1,2,3,4 correctly. The claim was unfounded.                 |

## Refutation - a finding in the audit that does not hold

| ID   | Claim                                                           | Verdict                                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-01 | That doc 85 has malformed version metadata (`Version: ** 1.0`). | REFUTED as stated. 85:3-6 is well-formed Markdown: `**Version:** 1.0` with two-space line breaks; character codes confirm `**Document:` etc. The legitimate residue is style only: doc 85 was the sole file using bold metadata while the other 87 use plain `Version: 1.0`. Normalised as a style fix, not a defect fix. |

## Tooling artifact recorded so it is not "fixed" by mistake

Reading the `.txt` corpus through the PowerShell console rendered en-dashes as `a-EUR-`
mojibake and even dropped a space in "Manual MiniPay". Reading the same files with
explicit UTF-8 showed correct characters and a real U+2013 en-dash. The `.txt` files are
valid UTF-8. This is a console decoding artifact, NOT a file defect. Do not re-encode
the corpus.

## Open items requiring owner input (not code defects)

1. Celo token contract addresses for USDT/USDC/USDm/USAT. All four remain inactive
   until supplied and RPC-verified. Never infer support from a ticker symbol.
2. Nigerian legal/accounting review of the user-funded balance (doc 84 section 7) is a
   launch gate. It cannot be engineered around.
3. No support email is configured. Documentation must not invent one (doc 85).

## Q-08 - Reward lifecycle vocabulary differed between doc 05 and doc 35

Found: 2026-09-30, by a failing unit test written against the corpus.

Doc 05 REWARD LIFECYCLE (narrative): ELIGIBILITY_CHECKED -> PENDING ->
APPROVED/AVAILABLE -> WITHDRAWN or REVERSED/CHARGEBACK.

Doc 35 STATES (normative list): ELIGIBLE, PENDING, AVAILABLE, ON_HOLD, REVERSED,
CHARGEBACK, CANCELLED, EXPIRED.

These are different vocabularies for the same lifecycle. Doc 05 mentions
ELIGIBILITY_CHECKED, APPROVED and WITHDRAWN; doc 35 uses ELIGIBLE and adds ON_HOLD,
CANCELLED and EXPIRED.

Resolution: doc 35 governs, because it is the reward-engine states specification and
the more specific contract. app.reward_state implements doc 35 exactly. A NOTE was
added to doc 05 pointing at doc 35 so the narrative cannot be mistaken for the enum.

Correction to an earlier claim in this log: the statement that ELIGIBILITY_CHECKED
appears in both the reward and the withdrawal lifecycle is true of doc 05 PROSE only.
It is NOT in the normative reward enum, so reward_state and withdrawal_status do not
in fact collide on any value. The namespacing rule stands on its own merits (different
domains, different machines) but it is not a collision fix.

## Q-09 - `states.ts` comment contradicted this log

Found: 2026-09-30, while implementing the withdrawal slice.

The NAMESPACING comment in `src/lib/contracts/states.ts` still asserted that
ELIGIBILITY_CHECKED "exists in BOTH the reward lifecycle and the withdrawal
lifecycle", which is the claim Q-08 corrects. The code was right; the comment
was stale and would have re-introduced the false premise for the next agent.

Corrected in `src/lib/contracts/states.ts` and `tests/contracts/states.test.ts`
to state the accurate rule: reward_state uses ELIGIBLE, withdrawal_status uses
ELIGIBILITY_CHECKED, and the two enums are separate machines.

## Q-10 - Postgres error codes vs constraint names in pgTAP

`supabase/tests/withdrawal.sql` asserts on BOTH an error code and a constraint
name. Check-violations surface as SQLSTATE 23514 and integrity violations as 23505. A named check constraint is reported through its `CONSTRAINT` field, so
the tests assert the constraint name where one exists rather than matching a
human-readable message. This is deliberate: asserting on message text would make
the tests brittle to harmless rewording, and asserting only on the code would not
prove WHICH invariant fired.

## Verification state of the withdrawal slice

Implemented and statically checked: migrations 006 and 007, the pure TypeScript
mirror, and 20 pgTAP assertions.

NOT yet executed: the pgTAP suite. Docker is not running on this machine, so
`supabase test db` cannot start a local Postgres. The assertions are unproven
until the owner runs them. This is recorded here rather than presented as a pass.

## Q-11 - Migrations 010 and 012 were truncated by a file-editing accident

Found: 2026-09-30, while building notifications and support.

An editor operation inserted content at a fixed line offset instead of replacing
an existing marker. That split two PL/pgSQL function bodies mid-statement:

- migration 010: `transition_reward` lost its closing `$$;` and its audit insert;
  `reverse_reward` received a duplicated tail.
- migration 012: `create_support_ticket` and `post_agent_reply` were both cut off
  mid-`perform` call, leaving orphaned SQL at end of file.

Both files still had an EVEN number of `$$` delimiters and an even number of
`if`/`end if` pairs, which is why the earlier structural check passed them. An
even count can be satisfied by a truncation plus a duplicate tail.

Detection: a stricter check was added that pairs each
`create or replace function` declaration with the NEXT `$$;` line, and fails on an
unclosed function, an orphan close, or a duplicate tail. It found the corruption
in migration 010, which had already been committed to the repository and
described in a previous change record as working.

Lesson recorded: a delimiter COUNT is not a correctness proof. Only ordered
pairing is.

Resolutions: both migrations repaired. A final sweep across all 12 migrations now
reports 26 functions and ZERO pairing, marker, or block-balance errors.

## Q-14 - A generated column referenced another table's column

Found: 2026-10-01, by `supabase db push`.

Migration 021 declared:

```sql
score_xp bigint generated always as (xp) stored
```

`xp` is a column of `app.game_players`, not of `app.game_leaderboard_entries`.
A generated column expression may only reference columns of its own row, so
CREATE TABLE failed with SQLSTATE 42703.

**Why it was written.** The intent was correct and worth keeping: doc 28 requires
that leaderboard scores "derive from authoritative game data, not
client-submitted totals", and a generated column looked like the strongest way to
guarantee that. The mechanism was simply impossible. A trigger cannot be
subverted by a client writing a row either, so the guarantee survives the change
of approach; what is lost is "cannot be written at all", which was never
available for a cross-table derivation.

**Fix.** `trg_game_players_leaderboard` overwrites `score_xp` from
`app.game_players.xp` on every authoritative XP change, and the browser roles
hold no grant on the table.

**Lesson.** The pgTAP suite had asserted the intended property using
`information_schema.columns.is_generated`. That assertion was testing that the
column was generated, not that the score was authoritative, so it passed on a
schema that could not exist. The assertion now tests the trigger and the
`new.xp` reference instead, which is the property actually required.

## Q-13 - Migration 006 was truncated, absorbing three later tables

Found: 2026-10-01, only because `supabase db push` was finally run.

`app.minipay_destination_verifications` lost its column body and its closing
`);`. Its opening parenthesis therefore never closed, so the three tables that
followed it - `app.withdrawal_requests`, `app.payment_operations` and
`app.cash_link_operations` - were parsed as part of that table body. The
resulting SQLSTATE 42601 pointed at the second `create table`, which is why the
error message appeared to blame `withdrawal_requests` when the fault was
sixty-odd lines earlier.

The orphaned tail was still present further down the file, carrying
`reviewer_id`, `decision`, `reason`, `evidence`, `decided_at` and both
constraints. That is what made faithful reconstruction possible rather than
guessing. `created_at` was the only column with no surviving fragment; it was
added because every other table in the file carries one.

**Why the checker missed it for so long.** `tools/check-migrations.mjs` paired
function declarations with their `$$;` and counted parens per table. Both counts
balance here: the swallowed tables contribute their own balanced parentheses,
so a truncation plus several well-formed tables satisfies a COUNT exactly as
well as the healthy file does. This is the third instance of the truncation
class (see Q-11).

**Fixes.** Migration 006 reconstructed, and `checkTableBlocks` added to
`check-migrations.mjs`, which fails on any `create table` that never reaches its
own `);`. Verified against a synthetic truncated fixture.

## Q-12 - `BigInt('')` is `0n`, so an absent amount read as a real zero

Found: 2026-09-30, by a unit test written against the outbox payload readers.

`src/lib/observability/payload.ts` read minor-unit amounts from outbox payloads,
where Postgres transmits a bigint as a STRING. The original implementation was:

    if (typeof value === ''string'') { try { return BigInt(value); } catch { return null; } }

`BigInt('')` returns `0n` and does NOT throw. `BigInt(' ')` also returns `0n`.
So an event whose payload lacked an amount would have been read as a genuine zero,
and the user would have been sent a notification stating `0 NGN` as a real
amount rather than being given no figure at all.

This is the failure mode the test suite exists to catch: a plausible-looking
notification carrying a wrong number. It is worse than a null, because a null is
visible to the caller and a zero looks authoritative.

Fixed: an emptiness check precedes the conversion, and the string is trimmed
before conversion. A genuine `0` still parses as `0n`, because a real zero is a
real value and must not be discarded. Covered by four tests.

Generalisation recorded for future readers: any BigInt parse of untrusted JSON
must reject empty and whitespace-only strings explicitly. Relying on the
constructor to throw is insufficient.

## Q-13 - Twelve call sites read or wrote `app` tables through the Data API

Found: 2026-10-01, while converting reads to `public` RPC wrappers.

The `app` schema is deliberately NOT exposed through the Supabase Data API. A
`createAdminClient().from('some_app_table')` therefore targets
`public.some_app_table`, which does not exist, and fails with PGRST205 on every
call even with all migrations applied.

Twelve call sites did this. Six were reads that would have returned empty or
errored, and SIX were WRITES. The writes are the serious ones:

1. `app.deposit_requests` UPDATE plus a separate `app.deposit_events` INSERT,
   in the deposit submit-tx route. This could not have worked, and the shape
   was independently wrong: a failed event insert left a deposit marked
   SUBMITTED with no record of who submitted it, and the route logged and
   continued. Fixed by migration 032 (`app_private.submit_deposit_tx`), which
   does the state change and the audit event in one transaction.

2. `app.provider_callbacks` INSERT. This one has been live since migration 014
   created the table, with a COMMENT promising "written before processing so a
   failure cannot erase the trail". In practice NO provider callback evidence
   was ever recorded. Every callback was authenticated, verified and acted upon
   with no durable evidence row. For a system whose law 62 requires
   authenticated and auditable provider callbacks, and whose fraud posture
   depends on being able to show what a provider actually sent, this was the
   most serious defect found in this pass. Fixed by migration 033.

3. `app.provider_conversions` INSERT, plus a read to resolve it after a unique
   violation. Fixed by migration 034 (`record_provider_conversion`), which
   also closes a race: the old code caught a 23505 and re-read the winning row
   from TypeScript, leaving a window in which the answer could change.

4. `app.provider_callback_results` INSERT. Fixed by migration 034
   (`record_callback_outcome`), now idempotent on callback_id.

Why the argument matters: this was not found by reading the schema. Every one of
these was plausible code that typechecked and linted. It was found by looking for
`.from()` calls and treating each as a defect to explain. `tools/check-data-api.mjs`
now enforces that, harvesting the table list from the migrations rather than
maintaining it by hand, because a hand-maintained list rots and a rotted list
silently stops catching the thing it exists to catch.

## Q-14 - The deposit submit-tx route validated a deposit ID as a transaction hash

Found: 2026-10-01, while converting the route.

    const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
    if (!depositId || !TX_HASH_RE.test(depositId)) {
      throw new RouteError('invalid_request', 'Unknown deposit reference.');
    }

`depositId` comes from the URL path and is a deposit's UUID. `TX_HASH_RE` accepts
a 32-byte transaction hash. No UUID matches it, so the route rejected every valid
request before reaching the database, and reported a malformed UUID to the user as
"Unknown deposit reference", which points at the wrong cause entirely.

Fixed with a `UUID_RE`. This was invisible to typecheck, lint and the unit tests
because all three were reasoning about types rather than about a value that is
always wrong.

## Q-15 - The admin deposit wrapper was too narrow to work from

Found: 2026-10-01, while converting the admin queue.

`list_deposits_awaiting_review` returned eight columns. The admin route needed
twenty-one: `tx_hash`, `transfer_log_index`, `verified_amount_minor`,
`verification_status`, `review_reason`, `required_approvals`, `user_id`,
`chain_id` and the timestamps. A reviewer cannot confirm a deposit without
comparing what was declared against what actually landed on chain, and cannot
escalate without knowing why it did not verify.

The narrow wrapper was "safe", and safe-but-unusable is how a design gets
undermined: the operator would have gone looking for a direct table read, which
is precisely what this architecture removes. Widened to the reviewer's full
decision surface, with the boundary stated in the comment: transaction detail
yes, personal identity and risk signals no.

## Q-16 - PGRST002 is an infrastructure fault, not an application defect

Found: 2026-10-01, while investigating a runtime failure that followed CR-0013.

Symptom: every read failed at once, across unrelated tables.

    [notifications] unread count failed  { code: 'PGRST002' }
    [auth] profile read failed         { code: 'PGRST002' }
    Error: wallet: unable to read accounts (Could not query the database for the
    schema cache. Retrying.)

PGRST002 means PostgREST could not reach PostgreSQL to load its schema cache. It
is NOT the same fault as the PGRST205 fixed in CR-0013, and the two are easy to
confuse because both present as "the database call failed":

- PGRST205 - PostgREST is healthy, but the table is not in its cache. This is
  the `app` schema exposure problem. CR-0013 fixed it.
- PGRST002 - PostgREST is healthy and authenticating, but it cannot open a
  database connection. Every request fails, whatever the table.

A PGRST002 masks any PGRST205 underneath it, so this must be resolved before the
CR-0013 changes can be observed working.

Reproduced outside the application, which is what confirms it is not a code
defect:

    GET /rest/v1/  (authenticated)                    -> 503 PGRST002
    POST /rest/v1/rpc/get_unread_notification_count    -> 503 PGRST002
    GET /rest/v1/  (unauthenticated)                   -> 401, i.e. reachable

The unauthenticated 401 proves PostgREST, Kong and the project are up and
reachable. Only the database leg is failing. Note that migrations 030-034 are
STILL PENDING on the remote project, so none of the new wrappers exist yet; the
PGRST002 is present regardless, which independently confirms the two are
unrelated.

### A second, independent fault: the direct connection string cannot be used

`SUPABASE_DB_URL` was set to:

    postgresql://postgres:[... ]@db.apdjiraovzersfqpbzhm.supabase.co:5432/postgres

That host resolves to an IPv6 address only (2a05:d018:cb1:bb00:...), and TCP to
:5432 fails from this machine. `db.<ref>.supabase.co` is IPv6-only by design; it
is not a typo. The pooler is the IPv4 path:

    aws-0-eu-west-1.pooler.supabase.com:6543   (transaction pooler, works)
    aws-0-eu-west-1.pooler.supabase.com:5432   (session pooler, works)

So `npm run db:push` and `npm run test:db` cannot work over the direct URL from an
IPv4-only network, which explains why migrations 031-034 were never applied and
why the pgTAP suites have never run. This is very likely the same underlying
constraint: the project is on an IPv4-only network, and it is the most plausible
cause of the PGRST002 as well. It requires a Supabase-side check (project
health, connection limits, or pool exhaustion) to confirm.

### Not fixed here

No code was changed. The reads fail closed by design, and `getUserAccounts`
throwing on a database error is correct: showing an unverifiable balance is worse
than showing nothing. Weakening it to "handle PGRST002" would have hidden an
infrastructure outage behind a zero balance, which is precisely the failure mode
law 1 and law 45 exist to prevent.

## Q-17 - An OUT parameter with a scalar `returns` stops the whole migration run

Found: 2026-10-01, on the first `db push` of migration 034.

    ERROR: function result type must be boolean because of OUT parameters
    SQLSTATE 42P13

`app_private.record_provider_conversion` was declared as:

    p_correlation_id uuid default null,
    p_is_duplicate out boolean
    ) returns uuid

PostgreSQL derives a function's result type from its OUT parameters. An OUT
parameter is not an extra output channel bolted onto a declared return type; it
IS the return type. So the server read the OUT parameter, decided the result was
boolean, and rejected the declared uuid. There is no interpretation under which
these two clauses are compatible.

Fixed by returning a single `jsonb` object, `{id, isDuplicate}`, instead. That
was the better shape anyway:

  * `out` parameters have no clean representation over PostgREST, which is the
    only transport this platform has for privileged calls;
  * it is a single return value, so the whole result is one round trip;
  * the TypeScript caller was already reading `{ id, isDuplicate }`, so the
    signature change did not propagate into application code.

The alternative fix, a composite return type, would have required a `create type`
and made the migration harder to read for no benefit.

Migrations 031, 032 and 033 applied cleanly. 034 is transactional, so it rolled
back whole and left no partial state; `migration list` confirms 034 is the only
one unapplied.

### The lint that missed it, and the lint that would have missed it

`check:migrations` reported this file as `ok`. Five structural checks ran and
none of them can see a type mismatch; they pair `$$` delimiters, pair
`create table` blocks, and check reference ordering. A signature that is
syntactically perfect and semantically contradictory passes all of them.

So `checkOutParameterReturns` was added. It walks each declaration's parameter
list and fails when an `out`/`inout` parameter is declared alongside an explicit
`returns` type.

The first version of that check was itself broken, and this is worth recording:
it sliced the source from `close + 1` and then required a literal `)` in the
match. But `close` is the index OF the closing paren, so slicing past it
consumes the very character the pattern was looking for. It matched nothing,
ever, and reported `ok` on the exact defect it had just been written for.

It was caught only because the defect was re-injected and the gate re-run, which
is the same verification the CR-0013 gate received. A lint that has never been
shown to fail is not evidence of anything. The check is now proven in both
directions: 0 errors across all 34 migrations, and a failure on the reinjected
42P13.

Generalisation: a structural check must be demonstrated to fail on the defect it
was written for before it is trusted. Silence from a regex is not evidence.
## Q-18 - PGRST002 confirmed NOT to be a database fault; pooler region and port corrected

Found: 2026-10-01, while pushing migration 034.

### Q-16 revised: the database is healthy

Q-16 speculated that PGRST002 was probably connection exhaustion caused by the
IPv4-only network. That was wrong, and it is worth correcting because the
speculation was presented with more confidence than it had earned.

Measured directly against Postgres through the pooler:

    connections by state      active 1, idle 7, null 1   (9 total)
    max_connections           60
    blocking locks            0
    prepared transactions     0
    idle in transaction       0

The database is idle and completely healthy. There is no exhaustion, no lock, and
no stuck transaction. PostgREST is the failing component, and the fault is on the
Supabase side of the connection, not in anything this repository controls.

### The pooler URL I gave in Q-16 was wrong

Q-16 recommended ``aws-0-eu-west-1.pooler.supabase.com:6543``. Both parts were
wrong for this project:

  * the correct region is ``aws-1``, not ``aws-0``;
  * port 6543 with the ``postgres.<ref>`` username returns
    ``tenant/user ... not found``, while port 5432 returns
    ``no tenant identifier provided``.

The authoritative value was already on disk and I did not read it first. The CLI
caches it on link:

    supabase/.temp/pooler-url
    postgresql://postgres.<ref>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres

Lesson, recorded because it cost two failed pushes: when the CLI already holds a
connection string, read it rather than reconstructing one from the project ref
and a guess at the region. Supabase's pooler region prefix and port are not
derivable from the project ref, and both failure modes are unhelpful errors that
do not name the actual problem.

Also note ``supabase db push`` prompts for confirmation on a TTY and will hang
forever in a non-interactive shell. ``--yes`` is required for automation.

### Verification of CR-0013 against a real database

This is the first time any of the wrapper work has been checked by PostgreSQL
rather than by a structural lint. All 34 migrations applied. Confirmed directly:

  * all 31 ``public`` read wrappers exist and are ``SECURITY DEFINER``;
  * all 4 new ``app_private`` commands exist, including
    ``record_provider_conversion`` returning ``jsonb`` (the 42P13 fix);
  * LEAK CHECK - no wrapper is executable by ``anon`` or ``authenticated``.
    The query returned zero rows;
  * the ``app`` schema is NOT in PostgREST's exposed schemas, so the CR-0013
    decision is intact and PGRST205 remains the expected failure for any future
    direct table read.

So the wrapper design is verified as correct at the database level. What is still
NOT verified is that PostgREST can serve them, because PGRST002 blocks every
request before any function is resolved.
## Q-19 - ROOT CAUSE of PGRST002: the project has NO exposed schemas

Found: 2026-10-01, from `supabase_logs.json`. This supersedes the speculation in
Q-16 and the measurement in Q-18.

The postgres log shows one repeating error, every ~32 seconds, for the entire
capture window:

    level:    error
    status:   3F000            (invalid_schema_name)
    message:  schema "pg_pgrst_no_exposed_schemas" does not exist

`pg_pgrst_no_exposed_schemas` is a SENTINEL PostgREST probes for. PostgREST issues
a deliberate query against it, because a failure to find it is how PostgREST
detects the condition "my configured list of exposed schemas contains nothing
usable". The probe failing is the SYMPTOM, not the disease.

So: this project's Data API exposed-schema list is EMPTY. PostgREST starts, finds
no schema it is allowed to expose, cannot build a schema cache, and fails every
request with PGRST002. That is the whole fault.

This explains everything the earlier two rounds could not:

  * why the database was healthy (it was never the problem);
  * why `anon` and `authenticated` had CONNECT privilege (privileges are fine,
    the SCHEMA LIST is empty);
  * why direct Postgres queries worked perfectly while every REST call failed;
  * why auth worked (`/auth/v1/health` returned 200 throughout) while
    `/rest/v1/*` returned 503 - they are separate services.

### Why it matters for CR-0013

The good news, and it is worth stating precisely: this is NOT caused by the
`app` schema being hidden. Hiding `app` is deliberate and correct (migration 001,
AGENTS.md). The bug is that the list is empty rather than containing `public`.

### THE FIX

Supabase Dashboard -> Project Settings -> API -> "Exposed schemas" field. It must
contain:

    public, graphql_public

Save. PostgREST reloads its schema cache and the 503s stop.

### THE ONE THING NOT TO DO

Do NOT add `app` to that field to "make it work". It would immediately make all
70 tables reachable through PostgREST and undo CR-0013 entirely. The field should
end up containing `public` and `graphql_public` only. If `app` appears in that
box, that is the bug, and the fix is to remove it - not to add more.

### Not fixable from here

Changing it requires the Dashboard or a Management API personal access token.
Neither the Supabase CLI token store nor a `SUPABASE_ACCESS_TOKEN` env var is
present in this environment, so this cannot be automated from the repo.
## Q-20 - The Supabase April 2026 breaking change, and why this project is exposed to it

Found: 2026-10-01, from the platform changelog, prompted by the Q-19 diagnosis.

Supabase announced on 2026-04-28 that new tables in `public` are no longer granted
to `anon` / `authenticated` / `service_role` automatically. The rollout:

    2026-04-28  changelog published; opt-out available at project creation
    2026-05-30  new behaviour is the DEFAULT for all NEW projects
    2026-10-30  enforced on all EXISTING projects

`vip.averra` was created **2026-09-30**, which is after 2026-05-30. So this project
was created under the new default unless someone ticked "Automatically expose new
tables" at creation time.

### Measured on this project

    default ACL for FUNCTIONS in public (grantor postgres):
        anon=X, authenticated=X, service_role=X
    tables in public:                 0
    anon/authenticated USAGE on public: true
    graphql_public schema:             exists (pg_graphql IS enabled)

The function default ACL is the one that matters here, and it is the direct cause
of the Q-19 failure mode. It grants EXECUTE on new functions in `public` to `anon`
by default, which means "create a function and PostgREST can see it" is no longer
automatic. Combined with a project whose exposed-schema list ended up empty,
PostgREST had nothing to build a cache from and returned PGRST002 on everything.

### GOOD NEWS: the CR-0013 design already complies, and now has to

Two things make this much less painful than it could have been:

  1. There are **zero tables in `public`**. Every application table lives in
     `app`, which is not exposed. The table-grant half of the breaking change
     therefore does not affect us at all, and cannot leak anything.

  2. Every wrapper and command was written with an EXPLICIT
     `revoke all ... from public, anon, authenticated` followed by
     `grant execute ... to service_role`. That is exactly the discipline the
     changelog is asking every project to adopt, and it was already the pattern
     here.

Verified against the live database rather than by reading our own SQL:

    wrappers executable by anon:            0
    wrappers executable by authenticated:   0
    wrappers executable by PUBLIC role:     0
    wrappers executable by service_role:    38  (of 38 total)

The `PUBLIC` row is the one worth having checked. PostgreSQL grants EXECUTE to
PUBLIC on every new function by default, so revoking only from `anon` and
`authenticated` would have left the door open. It is closed.

### The part that DID hide a real mistake

A first pass at that check reported "leak check: zero rows", which was FALSE and
dangerously reassuring. The query filtered wrappers with:

    p.proname like 'get\_%' AND p.proname like '%my\_%'

That matches only functions named `get_*my_*`. It silently missed `list_my_notifications`,
`list_my_support_tickets`, `list_my_task_attempts`, `owns_my_deposit`, all four
`app_private` commands, and most of the rest. A narrower predicate had reported
"safe" while most of the surface was unexamined.

This is the same failure mode as the aliased-column resolver recorded in
AGENTS.md and the OUT-parameter check in Q-17: a check whose filter is narrower
than the thing it claims to cover. It is worse here than a lint defect, because
this was a SECURITY assertion made in a report to the user.

Lesson, recorded because the mistake was mine: a security check must enumerate
the population and then filter, never filter first and call the remainder the
population. The corrected query keys on our own naming convention across both
schemas and counts the total alongside the vulnerable figure, so a predicate that
silently matches nothing is visible (38 total, 0 bad) rather than invisible.

### Action for this repository

  * No migration change is needed. The grants are already correct and verified.
  * A new pgTAP suite should assert this, because it is exactly the kind of
    property that rots. It is written against `information_schema` /
    `has_function_privilege`, so it needs a database and cannot be a static lint.
  * `db:types` and any future migration adding a `public` function MUST include an
    explicit revoke from `anon`, `authenticated` and `PUBLIC`, or the default ACL
    will expose it. This is now a platform default, not a Supabase convention.
## Q-21 - BLOCKING: 26 money-path commands are unreachable through the Data API

Found: 2026-10-01, immediately after the Q-19 exposed-schemas fix was applied.

Reads now work. Every write is dead.

### The mechanism

`app_private` holds 52 command functions and is deliberately NOT exposed through
the Data API, which is correct and is not the bug.

The bug is that `.rpc('name')` resolves ONLY against exposed schemas. With
`public` as the sole exposed schema, a `public` function is the ONLY thing an RPC
call can reach. Every command was created in `app_private` with NO `public`
entry point, so PostgREST cannot see it.

Verified live, not inferred:

    distinct .rpc('name') call sites in src/      51
    resolvable through the Data API               24
    return PGRST202 (404)                         27

Live proof of one:

    POST /rest/v1/rpc/create_deposit_request
    404 {"code":"PGRST202","details":"Searched for the function
         public.create_deposit_request ... but no matches were found
         in the schema cache."}

PostgREST searched `public`. The function is in `app_private`.

Confirmed against the live catalog, for the 27 broken names:

    exist ONLY in app_private:   26
    do not exist AT ALL:          1  -> get_task

One systemic fault plus one separate missing function, not 27 unrelated bugs.

### Why the earlier verification missed it

CR-0013 verified the wrappers EXIST, are `SECURITY DEFINER`, and are inaccessible
to `anon`/`authenticated`. All true. It never verified that the functions the
application CALLS are in an exposed schema, because every check asked "is this
correctly locked down" and none asked "is this reachable".

A function can be perfectly secured and completely unusable at the same time.
Those are independent properties, and only one was ever tested.

The reads happened to be built correctly. Migrations 032 and 034 created paired
`public` wrappers (`get_my_deposit`, `resolve_tracking_user`,
`tracking_already_converted`, `get_conversion_for_event`,
`get_active_provider_reward_source`) alongside the `app_private` commands. The
write commands got no such pairing, because pairing was applied per-migration by
whoever wrote it and nobody audited the resulting set.

### What is broken

Every money, identity, provider, game and support WRITE:

    deposits      create_deposit_request, submit_deposit_tx,
                  confirm_deposit, reject_deposit
    withdrawals   create_withdrawal_request
    tasks         start_task_attempt, submit_task_completion, record_task_signal
    providers     record_provider_callback, record_callback_outcome,
                  record_provider_conversion, apply_conversion_reward
    game          deploy_machine, request_machine_upgrade, claim_mission,
                  perform_game_action
    support       create_support_ticket, post_user_reply, post_agent_reply
    misc          mark_notification_read, attribute_referral,
                  create_notification, outbox claim/complete/fail/backlog

Including the outbox processor, which means the transactional outbox written
alongside every state change has no consumer; and `record_provider_callback`,
which was the specific defect CR-0013 was raised to close (Q-13).

This is the highest-severity finding in this project. The safety property it
protects - money moves only through a server-side command - is intact, because
the unreachable commands are simply unreachable. The CONSEQUENCE is that nothing
can move at all. The platform cannot take a deposit, pay a reward, or process a
provider callback.

### `get_task` is a different bug

`get_task` does not exist in any schema. It is called from
`src/app/api/tasks/[id]/start/route.ts` and
`src/app/(app)/tasks/[id]/page.tsx`. This is a missing READ wrapper, not a
command reachability problem, and needs its own function. `list_live_tasks`
exists and works; `get_task` was simply never written.

### The fix, and why it is NOT "expose app_private"

Exposing `app_private` would make all 26 reachable immediately, and it is the
wrong answer. It would publish every internal function to PostgREST at once,
including ones that should never be an API: `grant_reward`, `post_ledger_entry`,
`rebuild_account_balances`, `reverse_reward`, `assert_distinct_approver`. Each is
currently reachable only from inside another function's body, by PostgreSQL, with
no PostgREST surface at all. Exposing the schema converts deliberately designed
privilege boundaries into an accident of configuration - the exact failure mode
AGENTS.md warns about for `app`.

The correct fix follows the pattern already used by `get_my_deposit` and
`resolve_tracking_user`: a thin `public` `SECURITY DEFINER` wrapper per command,
same signature, delegating to the `app_private` command, granted to
`service_role` only.

    public.create_deposit_request(...) -> app_private.create_deposit_request(...)

This keeps `app_private` hidden, keeps every command service-role-only, and makes
the exposed surface explicit and reviewable rather than "whatever is in there".
It costs one wrapper per command, which is the price of not publishing the
schema.

AGENTS.md rule 4 already anticipates this. The same reasoning applies in reverse
here: a command with no public entry point is how you get a broken write path
that passes every security assertion.
## Q-22 - LIVE SECURITY LEAK: 31 pre-existing wrappers are executable by anon

Found: 2026-10-01, while verifying migration 035.

Every Q-13 to Q-20 conclusion that said "wrappers are NOT accessible to
anon/authenticated" was WRONG. It was wrong in my reports to the user, twice.

### Live proof, using the publishable (anon-role) key an end user holds

    POST /rest/v1/rpc/get_wallet_summary   200  {"userFunding": [], "earnedRewards": []}
    POST /rest/v1/rpc/list_my_deposits     200  []
    POST /rest/v1/rpc/get_my_depot         404  (correctly denied)
    POST /rest/v1/rpc/get_task             404  (correctly denied)
    POST /rest/v1/rpc/create_deposit_request 404  (correctly denied)

The first two SUCCEED for an unauthenticated caller.

### The actual ACLs

    get_wallet_summary     {postgres=X, service_role=X, anon=X, authenticated=X}
    get_my_deposit         {postgres=X, service_role=X, anon=X, authenticated=X}
    ensure_my_profile      {postgres=X, service_role=X, anon=X, authenticated=X}
    create_deposit_request {postgres=X, service_role=X}                      <- correct
    get_task               {postgres=X, service_role=X}                      <- correct

31 functions carry `anon=X, authenticated=X` in their ACL. They are the wrappers
from migrations 030, 031, 032 and 034. The two created in 035 are correct.

### WHY. This is the actual mechanism, and it is the same one as Q-20.

The default ACL for FUNCTIONS in schema public is:

    postgres:      {postgres=X, anon=X, authenticated=X, service_role=X}
    supabase_admin:{postgres=X, anon=X, authenticated=X, service_role=X}

Every function created in `public` is born with EXECUTE for `anon`. A
`create or replace function` does not overwrite the ACL, so a function that was
revoked keeps its revoke - but a function whose migration only ever GRANTED to
service_role, without revoking from anon first, has never been locked down at
all.

So the real difference was never "which migration wrote it". It is whether that
migration happened to include the `revoke all ... from public, anon,
authenticated` line. 030/031/032/034 did not all do so consistently; 035 does,
for all 27.

The `revoke ... from public` is the load-bearing part. `public` is the PUBLIC
pseudo-role, and 24 functions also still show `public=true` through it.

### Why every check I ran reported "0"

This is the same failure twice, and it is now clearly the dominant risk in this
project. My queries were:

    has_function_privilege('anon', p.oid, 'EXECUTE')

...run against a filtered population. In Q-20 the filter was
`proname not in (citext...)`, which is correct. But the first leak check in Q-20
filtered on `proname like 'get\_%' and proname like '%my\_%'`, and the Q-13
check used `proname like 'get\_%' and proname like '%my\_%'` as well. `list_my_deposits`
matches the second but not the first. `get_wallet_summary` matches NEITHER - it
has no "my" in the name. The most important read in the entire platform was
never inside the population I was measuring.

I then reported "0 rows" as a security result. It was a measurement of a
population I had defined to exclude the answer.

### What I got wrong, stated plainly

  * Q-20 reported "wrappers executable by anon: 0". False. It is 31.
  * I reported that as verified twice, to the user, as a security assurance.
  * The 47-function "citext" scare was real, but I then used it to reassure
    myself that the count was noise, instead of re-running the count with an
    unfiltered population.

The invariant I was checking - "is it locked down" - was tested only on
functions I had already decided were fine.

### The fix

Revoke from `public`, `anon` and `authenticated` on all 31, and fix the default
ACL so nothing in `public` is born executable by `anon`:

    alter default privileges in schema public
      revoke execute on functions from public, anon, authenticated;

That last statement is the important one. Without it the next migration written
today re-opens this exact hole, and it will pass every check, because the
function will have been created correctly and only the DEFAULT is wrong.

### Standing rule, added to AGENTS.md

For any function in `public`, in this order:

    revoke all on function ... from public, anon, authenticated;
    grant  execute on function ... to service_role;

The revoke comes FIRST and from the PUBLIC pseudo-role as well as the two roles.
And a security assertion must enumerate the whole population and count it, never
filter to a subset and report the remainder as the result. AGENTS.md already
records the aliased-column resolver (false positive) and the OUT-parameter check
(false negative). This is the third, and the most serious, because unlike the
first two it was a claim about money in a report to the user rather than a lint
verdict.
## Q-23 - Default-ACL hardening is only possible for `postgres`, not `supabase_admin`

Follows Q-22. The live database, 2026-10-01.

    default ACL for FUNCTIONS in schema public, after hardening:
      postgres        {postgres=X, service_role=X}                  <- correct
      supabase_admin  {postgres=X, anon=X, authenticated=X, ...}     <- still open

    verified by creating a function as postgres and inspecting proacl:
      proacl: {postgres=X/postgres, service_role=X/postgres}
      anon=false  authenticated=false  PUBLIC=false  service_role=true

So a NEW function created by `postgres` - the role every migration runs as - is
born locked. That was the goal of Q-22 and it is met.

### WHY supabase_admin CANNOT BE FIXED FROM HERE

`alter default privileges for role X` requires being `X` or a superuser. Verified:

    alter default privileges for role supabase_admin ... revoke execute ...
    -> permission denied to change default privileges

This project is unusual in the relevant way: `postgres` is NOT a superuser and
`supabase_admin` IS. Ownership of public functions:

    postgres        56 functions   (all of ours)
    supabase_admin  47 functions   (all citext extension internals)

So the split is fortunate rather than lucky. Every application function is owned
by `postgres`, whose defaults are now hardened; every function owned by
`supabase_admin` is citext internals that expose no data and were deliberately
left untouched in migration 036.

The residual risk is narrow and worth stating precisely rather than alarmingly:
anything created in the Supabase dashboard SQL editor may run as `supabase_admin`
and would be born executable by anon. The fix needs the supabase_admin role or a
superuser:

    alter default privileges for role supabase_admin in schema public
      revoke execute on functions from public, anon, authenticated;

Until then, `npm run check:grants` is what covers a function written by hand,
because it inspects the migration source rather than trusting the role that
happened to run it.

### A correction to my own earlier report

I reported the hardening as NOT WORKING ("a brand-new function is still born
open") on the basis of a probe run immediately before the second ALTER was
applied. Re-run after it, the same probe shows the function born locked.

The first probe also used only `has_function_privilege`, which does not
distinguish an explicit anon grant from an EXECUTE inherited through PUBLIC.
The second reads `proacl` directly, which does. A security probe should report
the mechanism, not only the verdict - the verdict alone did not survive a change
in ordering.