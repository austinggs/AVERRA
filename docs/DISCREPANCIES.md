# Averra - Discrepancy Log

Document: docs/DISCREPANCIES.md
Last reviewed: 2026-10-09
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

Resolved 2026-10-02 (CR-0015). The IPv6-only behaviour above is now confirmed
from the vendor rather than inferred from a local socket failure, and it is
policy, not a misconfiguration. Supabase's "PGBouncer and IPv4 Deprecation"
notice states that IPv4 addresses stopped being assigned from 15 January 2024,
that "db.projectref.supabase.co will start resolving to a IPv6 address instead",
that "Supavisor will continue to return IPv4 addresses, so you can update your
applications to connect to Supavisor instead", and - naming this very
environment - that the change is "required if you are using from the CLI from an
environment without IPv6 support, like Github actions or possibly from your home
network".

Two corrections to the detail above, both observed on 2026-10-02:

- the working pooler host in this project is `aws-1-eu-west-1`, not the
  `aws-0-eu-west-1` written above. The region token moves, so read it from
  `supabase/.temp/pooler-url` rather than copying it out of a document;
- the failure mode is `getaddrinfo ENOTFOUND db.<ref>.supabase.co` - DNS
  resolution fails outright here, which is the same leg failing by a different
  route than "TCP to :5432 fails".

`supabase/.temp/pooler-url` holds the pooler host with NO password, and
`.env.local` holds the password against the DIRECT host, so neither file alone
yields a usable URL. The pooler host plus the `.env.local` password is the
combination that connects; this is the string that must also go into the CI
secret, because a GitHub-hosted runner is IPv4-only for the same reason. See the
comment on the `db-tests` job in `.github/workflows/ci.yml` and Q-30.

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

- `out` parameters have no clean representation over PostgREST, which is the
  only transport this platform has for privileged calls;
- it is a single return value, so the whole result is one round trip;
- the TypeScript caller was already reading `{ id, isDuplicate }`, so the
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

Q-16 recommended `aws-0-eu-west-1.pooler.supabase.com:6543`. Both parts were
wrong for this project:

- the correct region is `aws-1`, not `aws-0`;
- port 6543 with the `postgres.<ref>` username returns
  `tenant/user ... not found`, while port 5432 returns
  `no tenant identifier provided`.

The authoritative value was already on disk and I did not read it first. The CLI
caches it on link:

    supabase/.temp/pooler-url
    postgresql://postgres.<ref>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres

Lesson, recorded because it cost two failed pushes: when the CLI already holds a
connection string, read it rather than reconstructing one from the project ref
and a guess at the region. Supabase's pooler region prefix and port are not
derivable from the project ref, and both failure modes are unhelpful errors that
do not name the actual problem.

Also note `supabase db push` prompts for confirmation on a TTY and will hang
forever in a non-interactive shell. `--yes` is required for automation.

### Verification of CR-0013 against a real database

This is the first time any of the wrapper work has been checked by PostgreSQL
rather than by a structural lint. All 34 migrations applied. Confirmed directly:

- all 31 `public` read wrappers exist and are `SECURITY DEFINER`;
- all 4 new `app_private` commands exist, including
  `record_provider_conversion` returning `jsonb` (the 42P13 fix);
- LEAK CHECK - no wrapper is executable by `anon` or `authenticated`.
  The query returned zero rows;
- the `app` schema is NOT in PostgREST's exposed schemas, so the CR-0013
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

- why the database was healthy (it was never the problem);
- why `anon` and `authenticated` had CONNECT privilege (privileges are fine,
  the SCHEMA LIST is empty);
- why direct Postgres queries worked perfectly while every REST call failed;
- why auth worked (`/auth/v1/health` returned 200 throughout) while
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

- No migration change is needed. The grants are already correct and verified.
- A new pgTAP suite should assert this, because it is exactly the kind of
  property that rots. It is written against `information_schema` /
  `has_function_privilege`, so it needs a database and cannot be a static lint.
- `db:types` and any future migration adding a `public` function MUST include an
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

- Q-20 reported "wrappers executable by anon: 0". False. It is 31.
- I reported that as verified twice, to the user, as a security assurance.
- The 47-function "citext" scare was real, but I then used it to reassure
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

## Q-24 - pgTAP's `throws_ok` compares the expected message by EXACT equality, not as a regex

Found 2026-10-02 while running `supabase/tests/` for the first time.

The ten pgTAP suites had never been executed, because `supabase test db` needs
Docker and Docker was unavailable. Running them revealed that 14 assertions across
five suites could never have passed. They were written as

    throws_ok($$ ... $$, '23514', 'task_definitions_reward_needs_funding', 'description')

on the assumption that the third argument is a pattern matched against the error
message. It is not. The deployed extension requires `SQLERRM = errmsg` character
for character, so the expected message must be the whole sentence PostgreSQL emits:

    new row for relation "task_definitions" violates check constraint "task_definitions_reward_needs_funding"

Measured directly against the deployed extension:

    expected errmsg                    result
    ---------------------------------  ------
    null (errcode only)                ok
    the full SQLERRM                   ok
    the constraint name alone          not ok
    '.*constraint_name.*'              not ok

### The fourth row is the important one

A regex wrapper fails too, so this is genuine equality rather than an escaping
mistake. That also rules out the tempting shortcut of passing `null` for the
message. An errcode plus `null` DOES pass - but almost every check constraint in
this schema raises `23514`, and a table carries several of them. `throws_ok(sql,
'23514', null, ...)` is satisfied by the wrong constraint firing, so it is not a
test of the rule it names.

The fix is to write the whole message. The constraint name is inside it, so the
assertion still identifies which rule fired, and it now matches what the database
actually says. All 14 were corrected in CR-0015.

### Two of those 14 were testing the WRONG rule

The full message is what exposed this, and the abbreviated form would have hidden
it:

- `tasks.sql` test 6 - "a self-attested task cannot be set to auto-verify". Its
  fixture passed `funding_source_id = null` while also paying 1000, so
  `task_definitions_reward_needs_funding` fired. The self-attestation rule was
  never exercised.
- `risk_moderation.sql` test 10 - "a moderation block must name a reviewer". Its
  fixture set neither `reason_code` nor `reviewed_by`, and the reason constraint
  sorts first, so that is the one reported.

Both fixtures were fixed to break exactly the rule under test.

### Standing rule

Write the full message. Do not abbreviate to the constraint name, and do not pass
`null`. See AGENTS.md, "Database tests (pgTAP) - read this first".

## Q-25 - Casting an enum label to `text` makes `results_eq` unresolvable

Same session. Three suites aborted with

    could not determine which collation to use for string comparison

and because an error inside a `begin; ... rollback;` suite aborts its transaction,
each of those suites stopped dead - which is why three of them reported zero
assertions and no plan at all.

The cause is a collation clash that the `::text` cast hides:

    pg_enum.enumlabel  is type `name`,  collation C
    name::text         is type `text`,   collation C   <- the cast CARRIES it
    '{A,B}'::text      is type `text`,   collation default (en_US.UTF-8)

PostgreSQL will not guess between two explicitly specified, different collations,
and `results_eq` compares the two results as values rather than coercing one to the
other. So `array_agg(e.enumlabel)::text` cannot be compared against a `text`
literal.

### What was measured

    A  drop the ::text cast on the literal        ERROR (the literal takes the default)
    B  collate "C" on BOTH sides                  ok
    C  compare as name[] on both sides            ok
    D  CONTROL: the form the tests shipped        ERROR

`name[]` was chosen: it removes the offending cast instead of overriding the
collation, and the labels genuinely ARE names. Three `results_eq` sites were
converted.

### Why some suites passed all along

`is()` tolerates the same expression that `results_eq()` rejects, which is why four
vocabulary assertions elsewhere in the corpus were green from the start. The
difference is in how pgtap implements the two functions, not in the SQL. Anyone
"simplifying" the `name[]` form back to `::text` for consistency with `is()` will
re-break three suites.

## Q-26 - The advertiser billing constraint was INVERTED (fixed by migration 037)

This is the finding that made the whole exercise worthwhile, and it is a live
SCHEMA defect rather than a test defect.

Doc 42 BILLING: "Advertiser charges reconcile to VERIFIED conversions and agreed
pricing, not raw clicks." Migration 025 tried to enforce that as

    constraint campaign_conversions_unverified_not_charged check (
      verified = false or charged_amount_minor = 0
    )

which is the inverse of its own comment ("an UNVERIFIED conversion is never
billed") and of the document. Evaluated:

    verified = false, charged = 5000   -> TRUE  -> ACCEPTED   <- unverified billing
    verified = true,  charged = 5000   -> FALSE -> REJECTED   <- a verified charge refused
    verified = false, charged = 0      -> TRUE  -> accepted
    verified = true,  charged = 0      -> TRUE  -> accepted

Both halves are wrong, and the second is the louder one: as shipped, a legitimate
invoice for a verified conversion was UNREPRESENTABLE. The bug would not have shown
up as an overcharge; it would have shown up as billing that could not be recorded
at all.

### How it was found

`supabase/tests/growth.sql` asserted exactly this rule and had never been run. The
tempting move - and the one forbidden by the source-of-truth hierarchy - is to
relax the assertion to match the database. Doc 42 outranks the migration, so the
migration is the bug.

### The fix

Migration 037 drops and recreates the constraint with the correct polarity:

    check (verified = true or charged_amount_minor = 0)

Verified live before and after, including the behaviour of both cases above, and
the row population was counted first (0 rows, 0 rows that the corrected rule would
reject) so the `alter` could not fail on existing data. The suite's assertion is the
regression test and was left as it was.

## Q-27 - Four assertions in the corpus could never fail

An assertion that cannot fail is worse than a missing one, because it is counted as
coverage. Each of these was green-looking and proven nothing.

### 1-3. `throws_ok` recorded "no exception" against an empty table

    insert into app.referrals (code_id, referrer_user_id, referee_user_id)
    select id, user_id, user_id from app.referral_codes limit 1

`app.referral_codes` is empty, so `limit 1` produced ZERO ROWS, the insert inserted
nothing, and the statement raised nothing. `throws_ok` reported "caught: no
exception" and the assertion failed - but for three assertions in one suite the
same shape would silently pass a variant written with `lives_ok`, and the
description ("a user cannot refer themselves") would never have been checked.

Fixed by creating the fixture rows the statement needs: an `auth.users` row (required
by `referral_codes.user_id`) and the referral code itself, selected by value.

### 4. A NULL foreign key died before the rule under test

    values (gen_random_uuid(), (select id from app.game_missions limit 1), -1)

`app.game_missions` is empty, so the subselect is NULL and the insert failed on
NOT NULL (23502). The rule under test was never reached. Fixed by inserting the
mission in the same statement.

### The enforcement order that makes fixtures honest

    1. NOT NULL     (23502)  enforced first, while the row is built
    2. CHECK        (23514)  enforced next, in constraint-NAME order
    3. FOREIGN KEY  (23503)  checked LAST, after the row is written

Two consequences, both of which bit this corpus:

- A random uuid in an FK column is fine when the CHECK you mean to test is
  violated, because the CHECK fires first. That is why most fixtures here can use
  `gen_random_uuid()` for `user_id`.
- Every NOT NULL column must still be supplied.
  `payout_destinations.account_identifier` was not, so a method-check assertion was
  really testing NOT NULL.

And where a fixture breaks TWO constraints, PostgreSQL reports the one sorted first
by name - which is not necessarily the rule the test names. See Q-24.

## Q-28 - Two suites could not execute at all

Both were invisible for the same reason as Q-24: nothing ran them.

### `withdrawal.sql` ended in a syntax error

The file had `select * from finish(); rollback;` and THEN more SQL:

    select * from finish();
    rollback;
      $$
        insert into app.withdrawal_requests (...)
        select u.id, 'MINIPAY_MANUAL', 'REQUESTED', d.id, 'NGN', 0, 0, 0
        ...
      $$,
      '23514',
      'withdrawal_requests_gross_positive',
      'a zero-amount withdrawal is rejected'
    );

A `throws_ok` block had been appended AFTER the closing `rollback;` - the signature
of the same absolute-offset editor defect as Q-11, this time in a test file rather
than a migration. `plan(20)` counted the 20 assertions in the valid part of the
file, so the orphan was surplus rather than missing, and the whole file failed to
parse.

The block asserts a real invariant, so it was RESTORED before `finish()` and the
plan raised to 21 rather than the fragment being deleted. Two other defects in the
same file were then reachable: the `split_exact` assertions expected SQLSTATE
`23505` (unique_violation) for a CHECK constraint, which is `23514`, so they could
never have passed either.

### `risk_moderation.sql` double-quoted a regex literal

    and p.prosrc ~ "decision <> 'ALLOW'"

In SQL, double quotes delimit an IDENTIFIER. That is not a string, so the statement
failed with

    column "decision <> 'ALLOW'" does not exist

and aborted the suite at test 20 of a `plan(33)`. Nothing after it had ever been
evaluated, including the assertion that the risk gate consults the decision at all.
Fixed to a single-quoted literal with doubled inner quotes.

This is worth separating from Q-24 because the failure mode is different: that one
produced `not ok` lines, which are visible. This one produced no line at all, and a
reader scanning for `not ok` would have found none and concluded the suite was fine.
A suite must be judged against its PLAN, not against the absence of failures - which
is why the runner asserts `ok + not ok == plan` and treats a missing plan as a
failure.

## Q-29 - An assertion that contradicted the approved spec, not the code

`game.sql` test 6 asserted that NO game table references a funding source:

    where t.relname like 'game_%' and pg_get_constraintdef(c.oid) ~ 'reward_sources'
    -- expected 0

It found 1: `app.game_missions.reward_source_id`. Unlike Q-26 this is NOT a code
defect, and the difference matters.

Doc 25 REWARDS: "Game rewards can be virtual, XP, items, or a FINANCIALLY FUNDED
reward. Financial rewards route through the Reward Engine." Migration 021 implements
that reference deliberately, with a five-line comment explaining that it is an
eligibility reference and never a payout instruction, and CR-0006 records the
decision. A separate assertion - that no game command function can reach
`grant_reward`, `post_ledger_entry` or `create_transition` - proves the column
cannot be used to pay.

So the TEST was over-broad relative to the approved spec, which outranks it. It was
narrowed to name the one permitted exception rather than relaxed to `>= 0`:

    select coalesce(array_agg(distinct t.relname order by t.relname), '{}'::name[])
    ... -- expected '{game_missions}'

That keeps the assertion strong in both directions: it fails if the documented
exception disappears, and it fails the moment any OTHER game table gains a direct
path to a funding source. Weakening it to a count would have lost both properties.

The lesson is not "the test was wrong, delete it". It is that a failing assertion
has three possible verdicts - the code is wrong (Q-26), the test is wrong (here), or
the test is right and unreachable (Q-25, Q-27) - and the source-of-truth hierarchy,
not convenience, decides which.

## Q-30 - The CI database-tests job was gated on an expression GitHub rejects

Found: 2026-10-02, by reading `.github/workflows/ci.yml` back after the test work had
been declared complete.

The `db-tests` job carried:

    db-tests:
      runs-on: ubuntu-latest
      if: ${{ secrets.SUPABASE_DB_URL != '' }}

The intent was "run the pgTAP suites once a database URL is configured, otherwise
skip". The effect is different in kind, not in degree. The `secrets` context is not
available to `jobs.<job_id>.if`, and GitHub validates the file and rejects it:

    The workflow is not valid. .github/workflows/ci.yml (Line: 51, Col: 9):
    Unrecognized named-value: 'secrets'.

This is documented behaviour rather than a version quirk. The context-availability
table lists only `github`, `needs`, `vars` and `inputs` for `jobs.<job_id>.if`, and
`actions/runner#520` is the original report of the identical symptom.

The consequence is the opposite of the intent: the guard would not have skipped one
job, it would have invalidated the ENTIRE workflow, taking the `verify` job - lint,
typecheck, unit tests, build and all five `check:*` gates - down with it.

### Why nothing caught it

No gate in this repository reads `.github/workflows/`. `lint`, `typecheck`, each
`check:*` and both test runners operate on `src/`, `supabase/` and `tools/`. A
workflow defect therefore has no local detector at all, and a green local run says
nothing about it. It was found only by reading the file back.

This is a different shape from Q-17 (a lint that false-negatived) and Q-22 (a check
that filtered its population). Those gates at least ran. Here there was no gate, and
the file was written and accepted on inspection.

### Fix

The presence test moved into the step, where `secrets` IS available, and is a shell
test rather than an `if`, so it can also say why it is not running:

      - name: Run database tests
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          if [ -z "$SUPABASE_DB_URL" ]; then
            echo "::warning title=Database tests did NOT run::..."
            exit 0
          fi
          npm run test:db -- --require-db

A skipped step renders grey and is easy to miss; a `::warning` annotation surfaces on
the run. The job stays green when the secret is absent, which is the documented
intent - the database suites are not a launch gate until the URL exists - but the
skip is stated loudly rather than implied by an invisible condition. When the secret
IS present, `--require-db` still makes a missing URL fatal, so the job cannot pass by
executing nothing.

The URL reaches the runner through `env:`, is never echoed, and is never placed on the
command line, so it cannot reach the job log.

## Q-31 - `app.has_capability()` passes a REVOKED operator

Found: 2026-10-02, while writing the authorization guard for the Reviews &
Community moderation commands (CR-0016).

The capability check that the foundation migration provides:

    create or replace function app.has_capability(p_capability text)
    ...
      select exists (
        select 1
        from app.admin_users au
        join app.admin_role_capabilities rc on rc.role_code = au.role_code
        where au.user_id = auth.uid()
          and rc.capability_code = p_capability
      );

`app.admin_users` carries `revoked_at`, `revoked_by`, and a partial index
`idx_admin_users_role ... where revoked_at is null`. The function filters none of
that, so an assignment that has been REVOKED still satisfies the check. Revocation
that does not revoke is the most dangerous shape a security bug can take: the
operator is told they were removed, the audit trail says they were removed, and the
guard still authorises them.

The TypeScript guard disagrees with it. `src/lib/auth/capabilities.ts` documents
"A revoked assignment is not a role" and its `getActiveAdminRole` returns null on a
revoked row. So the repository currently holds two definitions of authorization and
they do not match.

### Severity: latent, not live

`app.has_capability` is effectively unreachable. It reads `auth.uid()`, which is
NULL on the service-role connection every route handler uses, so every call returns
false - which is also why the routes query capabilities explicitly instead
(recorded in CR-0002). Nothing calls it today.

It is reported anyway, and not merely as housekeeping, because of its own comment:
"Canonical capability identifiers. Server-side guards and RLS must use these exact
codes." That is an invitation to use it, and the first person who does will get a
guard that fails closed on nothing and open on a revoked operator. It is also the
exact failure shape this corpus already documents twice: a check that appears to
enforce a property and does not (see the `checkOutParameterReturns` note in
AGENTS.md, and the empty-population count in the Q-22 leak).

### What CR-0016 did instead

The new moderation commands call

    app_private.operator_has_capability(p_user_id, p_capability)

which takes the operator id explicitly (never `auth.uid()`) and DOES filter
`revoked_at is null`. A pgTAP assertion proves an actor without `review.moderate` is
refused with `42501`.

### Not fixed here

`app.has_capability()` itself was left alone. Correcting it is a change to the
foundation authorization surface rather than to the reviews subsystem, and doing it
inside an unrelated migration would bury a security change in a feature change. It
should be its own change record, with an assertion that a revoked admin fails.

## Q-32 - A gate failed because its exclusion lived only on one machine

Found: 2026-10-02, when `prettier --check .` began failing on files inside
`.kilo/worktrees/humane-wallflower/`.

The stray directory is an agent-tool git worktree. It was excluded from git by
`.git/info/exclude` - a LOCAL, per-clone, uncommitted file. Prettier honours
`.gitignore` and `.prettierignore`; it does not read `.git/info/exclude`. So git
considered the directory invisible while prettier walked straight into it and found
unformatted YAML, JSON and Markdown from a second copy of the repository.

The failure was total: one stray directory made `prettier --check .` report the
whole repository as unformatted, which reads like a repository-wide problem rather
than a one-directory one. Worse, the fix is not visible to a reviewer either, since
`.git/info/exclude` is not in the repository.

Two things made it real rather than theoretical:

- `.kilo/` was not in `.prettierignore`, so nothing in the committed configuration
  protected the gate from it;
- the worktree carried its own copy of `AGENTS.md` and `AVERRA_FULL_PLAN/`, so
  workspace-wide searches matched duplicate files. That was observed directly: an
  earlier search in this same session returned that tree's files ahead of the real
  ones.

### Resolution

The worktree was removed (`git worktree remove`, after confirming it had no
uncommitted changes and sat at main's commit, so nothing was lost), and `.kilo` was
added to the tracked `.prettierignore`.

The general rule is the Q-30 rule seen from another angle: a gate whose inputs are
machine-local can fail - or silently pass - for reasons no reviewer can see. An
exclusion that lives in `.git/info/exclude` on one machine is not an exclusion. If
something must not be scanned or committed, the exclusion belongs in a tracked file.

## Q-33 - A grants assertion named one function and proved nothing

**Status:** FIXED in `supabase/tests/perks.sql` (CR-0017)
**Severity:** a test that could not fail on the defect it was written for

### What

The first draft of the anon-EXECUTE assertion in `perks.sql` was:

    select ok(
      not has_function_privilege(
        'anon', 'public.list_perk_products(uuid,integer)', 'EXECUTE'
      ),
      'an unauthenticated caller cannot execute the perk catalogue read'
    );

Migration 041 creates SIX functions in the exposed `public` schema:
`list_perk_products`, `list_my_entitlements`, `list_my_funding_spends`,
`purchase_with_funding`, `record_donation`, `refund_funding_spend`. The
assertion named exactly one of them, and only checked the `anon` role.

### Why it matters

This is Q-22's failure mode reached from a new direction, and the difference is
worth being precise about. Q-22's leak check filtered the population before
counting it, so its predicate matched nothing and reported `0 bad` as a security
assurance. This assertion is subtler: the predicate matches a real object, so it
is not vacuous, and it passes for a real reason. But it would still have passed
while `record_donation` - a function that creates a donation record a user can
read - sat wide open to anonymous callers. The breach is the Q-22 breach, one
function over.

The assertion was not wrong, it was narrow in a way that made its scope
invisible. Nothing in a green transcript distinguished "anon cannot reach the perk
catalogue" from "anon cannot reach anything in this subsystem."

### Resolution

Replaced with two population-first counts plus a guard on the population itself:

    select is((select count(*) ... where proname in (all six)), 6::bigint,
      'the grants population is six public functions, so the checks below see them all');

    select is((select count(*) ... and has_function_privilege('anon', ...)), 0::bigint,
      'no public function in this subsystem is executable by an unauthenticated caller');

    select is((select count(*) ... and has_function_privilege('authenticated', ...)), 0::bigint,
      'no public function in this subsystem is executable by a browser session role');

The first of the three exists so that a future rename or a dropped function makes
the count visible as `have: 5, want: 6` rather than silently shrinking the
population the other two queries filter. The `authenticated` check is new; the
original watched only `anon`.

Both bad-count assertions were proven to fail: granting EXECUTE on
`list_perk_products` to `anon` made exactly the first one report `have: 1, want: 0`.

### The general rule

A security assertion must name its whole population. "Assert X about the thing I
built" is a different and much weaker claim from "assert X about everything this
change created", and the difference is invisible in a green transcript.

## Q-34 - A test harness left an injected defect in the committed test file

**Status:** FIXED in `supabase/tests/perks.sql` (CR-0017)
**Severity:** a false alarm that reads exactly like a live security breach

### What

To prove the Q-33 assertions could fail, two defect-injection runs were launched
in the same batch against `supabase/tests/perks.sql`. Each harness read the file,
inserted a defect after `begin;`, ran `node tools/run-db-tests.mjs`, then restored
the file from the copy it had read at the start.

They ran concurrently. The first wrote its patched copy; the second then read
that already-patched file as its "original", patched it again, and on restore
wrote back a file that still contained the first harness's injected
`grant execute on function public.list_perk_products(uuid, integer) to anon;`.

The database was never affected. Every suite is `begin; ... rollback;`, so the
grant never outlived its transaction - verified directly against the live project,
where all six functions report `anon_exec = false`. But the grant sat on line 13
of the committed test file, and the Q-33 population assertion then failed on a
completely clean run: `have: 1, want: 0`.

### Why it matters

The symptom is the worst kind. A suite that was green turns red on the next
unrelated run, and the failing assertion is precisely the one guarding an
unauthenticated money path. The natural reading is that a real privilege leaked,
and the correct response to that reading is to go hunting for a breach in the
grants - which is expensive, and would find nothing.

The harness did report `RESTORED true`, and it was true: it compared the file
against the wrong copy. A verification that confirms the wrong baseline is worse
than no verification, because it converts a race into a false assurance.

### Resolution

The injected line was removed and the suite is green at 35/35. The lesson is
procedural and applies to any harness that mutates a tracked file to prove a
check fails:

- prove restoration against content you can identify independently (a checksum
  taken before the batch, not a variable captured inside a racy harness);
- never run two file-mutating harnesses against the same file concurrently.

### The general rule

A harness that mutates the thing under test can leave the thing under test
broken, and the breakage it leaves looks exactly like the defect being hunted.
When a security assertion fails with no code change, suspect the harness before
suspecting production - and check the file, not just the database.

## Q-35 - Two fixture statements produced result rows instead of assertions

**Status:** FIXED in `supabase/tests/perks.sql` (CR-0017)
**Severity:** silent loss of coverage

### What

Two statements in `perks.sql` were written as bare selects:

    select app_private.get_or_create_account(...) = app_private.get_or_create_account(...);
    select app_private.post_ledger_entry(...) is not null;

Both execute correctly - the funding account is created and the 20000-credit
seed entry is posted, which is what the later purchase assertions depend on. But
neither is a pgTAP assertion. A bare `select` returns a row of booleans; it
produces no `ok` line, so the runner counted nothing for either.

The suite ran 33 assertions against `select plan(34)`. The runner reported it
(`plan is 34 but 33 assertion(s) ran`) rather than passing quietly, which is the
behaviour it was built for, and that is the only reason this was caught.

### Why it matters

A fixture written as an expression looks like a check. Someone reading the suite
sees funding established and reasonably concludes it was verified. It was
established and NOT verified - and had the funding silently failed, the later
purchase assertions would have failed for a reason pointing at the purchase logic
rather than at the fixture.

This is the "cannot fail" class again, and it is the third gate in this
repository to report a reassuring number computed over something other than what
it claimed to cover: the aliased-column resolver that false-positived, the
OUT-parameter check that false-negatived, and the grants assertion of Q-33.

### Resolution

Both are now `select ok(...)`, and they assert something real rather than merely
evaluating: that the account lookup is idempotent (two calls return the same
account) and that the seed credit actually produced a ledger entry id. The plan
is 35 and the suite runs 35.

### The general rule

In a pgTAP suite, only a pgTAP function is an assertion. If a statement is a
fixture, write it so it reads as a fixture - and if it is worth executing, it is
usually worth asserting, because an unasserted fixture is a place for a silent
failure to hide.

## Q-36 - An assertion passed for a reason nobody could see

**Status:** FIXED in `supabase/tests/review_authoring.sql` (CR-0021)
**Severity:** a security assertion that could not fail

### The defect

The no-self-notification rule is the thing standing between "someone replies to
their own review" and a notification they did not want. The first draft asserted it
like this:

```sql
select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (
       select (app_private.submit_review_comment(
         p_user_id => '55555555-...',
         p_review_id => (select id from app.reviews where idempotency_key = 'pgtap-042-self'),
         p_body => 'Replying to my own review.',
         p_idempotency_key => 'pgtap-042-self-reply' )).id::text
      )),
  0,
  'replying to your own review enqueues nothing'
);
```

It returned `0`. It passed. And it was measuring nothing.

The scalar subquery CREATES the comment, the `after insert` trigger enqueues the
outbox event, and the outer `count(*)` reads the result - all inside ONE
statement. PostgreSQL evaluates the outer aggregate against that statement's
snapshot, which was taken before the subquery inserted anything. The newly
enqueued row is not visible to the same statement that caused it.

So the count is zero **whether or not the trigger fires**. Remove the
self-notification guard from the trigger entirely and this assertion still passes.

### How it was caught

Not by review. By the CONTROL assertion sitting next to it, which created a reply
from a DIFFERENT user against the same review and expected `1`:

    not ok 25 - CONTROL: a reply from another user DOES enqueue
        have: 0
        want: 1

The control owed one and got zero. That is the signature of a visibility problem
rather than a trigger problem - and it is exactly why the control exists. Without
it, the vacuous assertion would have shipped green and nobody would ever have
learned that the rule was untested.

### The fix

Creation and counting are now in SEPARATE statements, with the id captured in a
temporary table in between:

```sql
create temporary table t_self_reply on commit drop as
  select (app_private.submit_review_comment(...)).id as id;

select is(
  (select count(*)::int from app.outbox_events
   where event_type = 'review.comment.added'
     and aggregate_id = (select id::text from t_self_reply)),
  0, '...');
```

### The general rule

**An assertion that calls a mutating function inside the expression it is
measuring measures its own snapshot, not its own effects.** Whenever the value
under test is produced by the statement being tested, the write and the read must
be split across statements.

This is a fifth arrival of a pattern this repository has now hit repeatedly:
`tasks.sql` test 6 and `risk_moderation.sql` test 10 each reported the wrong
constraint, the NULL foreign key fixture died before reaching its rule, two
fixtures broke two constraints at once, and the `notifications_support.sql` grants
check named one function out of six. The common thread is never "the assertion is
absent". It is "the assertion runs and reports success without measuring the
property it names".

And the standing remedy is unchanged, and it worked here: put a CONTROL next to
the negative assertion, so a zero has to be distinguishable from a trigger that
never fires at all.

## Q-37 - Adding an enum value broke a suite that was pinning the old set

**Status:** FIXED in `supabase/tests/notifications_support.sql` (CR-0021)
**Severity:** a correct change that failed an existing test, and nearly got
suppressed

Migration 042 adds `COMMUNITY` to `app.notification_category` for review-reply
alerts. `notifications_support.sql` asserted the enum EQUALS the eight-value doc
45 list, so it failed:

    have: {REWARD,...,SYSTEM,COMMUNITY}
    want: {REWARD,...,SYSTEM}

That is the gate working correctly and the change being wrong-adjacent, so the
honest question is whether the ninth value is justified at all. It is: doc 45
REVIEW NOTIFICATIONS states "When another user replies to a review or configured
thread, Averra may create a factual in-app notification." The eight-value list was
an implementation mapping of doc 45's EVENTS prose, which never enumerated
categories exhaustively.

The tempting fix is to relax the assertion to a containment check. That would be
wrong: containment also passes if someone DELETED `SECURITY`, which is the failure
the test exists to catch. The list stays EXACT, now with nine values, carrying the
doc 45 citation and a note that the assertion is what caught it.

### The general rule

When a change breaks a test that pins a set, the first question is whether the
set or the change is wrong - not how to make the assertion pass. And a test can be
made to pass in ways that destroy its value; loosening an exact match to a
containment check is one, and it is invisible in the diff.

## Q-38 - Two migrations shipped a table that nothing could ever write to

**Status:** one FIXED (paid_perk_orders, CR-0022); one still open
(`review_comment_media` got its writer in CR-0021)
**Severity:** a complete subsystem that could not function, reported as complete

### The pattern

Two migrations in this repository created a table, gave it constraints, indexes, a
status enum and a comment describing its purpose, and never wrote a single row to
it. Neither omission was caught by the structural gates, because both files are
syntactically perfect.

| Table                      | Created in | Writer  | Found by                                       |
| -------------------------- | ---------- | ------- | ---------------------------------------------- |
| `app.review_comment_media` | 038        | CR-0021 | reading doc 86's API SURFACE against `pg_proc` |
| `app.paid_perk_orders`     | 040        | CR-0022 | grepping every migration for an INSERT         |

`review_comment_media` is the more embarrassing one: doc 86 IMAGE SUPPORT says
"Replies may also contain images", so the table was required by the spec and
unreachable by construction. Its status column, its MIME CHECK and its
storage-path constraints were all carefully modelled and all dead.

`paid_perk_orders` cost more. `purchase_with_funding` requires an order row and
refuses without one, so **every paid-perk purchase raised `unknown order` before
touching money**. CR-0017 recorded this subsystem as "COMPLETE at the database
level" on the strength of 35 passing pgTAP assertions - and those assertions passed
because `supabase/tests/perks.sql` inserted the order row DIRECTLY:

```sql
insert into app.paid_perk_orders (user_id, product_id, price_minor, unit, idempotency_key)
```

**The fixture covered the gap instead of exposing it.** That is the part worth
remembering. A test that fabricates the state a command is supposed to create will
pass forever while the command is missing, and it looks like thorough coverage.

### The general rule

**Before calling a subsystem complete, confirm something can WRITE to each of its
tables.** Not that the table exists, and not that the commands are declared -
that a writer exists.

Two cheap checks, both of which would have caught this:

1. For each table in a subsystem, grep the migrations for `insert into <table>`.
   No INSERT anywhere means no writer.
2. Never let a test insert a row that a command in the same subsystem is supposed
   to create. If a fixture must do it, the command is either missing or the fixture
   is lying about the integration.

This is the "enumerate the population, then filter" rule from Q-22 in a new place:
both omissions were invisible because nothing ever asked a question that would
have had an answer.

### Still open

The `GAME_PURCHASE` funding-spend path has the same shape. Migration 041 models the
enum value, the target column and the check, and no game purchase path exists -
that one is a deliberate deferral recorded in CR-0017 rather than an oversight, so
it does not belong in this entry. It does belong on the same checklist.

---

## Q-39 - An applied migration was edited, and `db push` silently skipped it

**Status:** corrected by migration 055; the process rule is the lasting fix.

**What happened.** Migration `20260930000054_referral_read_model.sql` was pushed to
the live database. Afterwards, `unit` was added to the body of
`public.get_referral_overview`. That edit never reached the database.

`supabase_migrations.schema_migrations` records a migration by version and never
compares file contents. A version already in that table is skipped by `db push`,
correctly and silently. So the file on disk described a function the database did not
have. The push printed `Finished supabase db push` and listed no migrations - the
same clean output as a push that did nothing because there was nothing to do.

**How it was caught.** By asking the database directly rather than trusting the push
output:

```sql
select case when prosrc like '%''unit'', coalesce%'
       then 'UNIT PRESENT' else 'UNIT MISSING' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'get_referral_overview';
```

`UNIT MISSING`. Typecheck, lint, `check:migrations` and `check:grants` all passed, and
409 pgTAP assertions passed, because none of them compare the file to the database.
`check:migrations` parses the file; it cannot know what was applied.

**Why this is the same failure as the gates that were built in this repo.** Every
structural gate in `tools/` reads the file on disk. A gate that never asks the
database cannot detect drift between the repository and the deployment. That is the
`0 bad` empty-population failure again, one level up: the checks were not wrong, they
were answering a narrower question than the one that mattered.

**Correction.** Migration 054 was left byte-identical, so a fresh install still
produces the intended definition. Migration 055 re-declares the function with
`create or replace`. Both paths converge, which is what makes the correction safe to
apply in either order.

**The rule.** A migration is frozen the moment it is applied. It is the authoritative
record of what the database received, and rewriting it destroys the only evidence of
that. Correct a deployed migration with a NEW migration, never by editing the applied
one. If the applied file is genuinely wrong as written, the correction belongs in the
next migration and the original stays as the historical record of the mistake.

This is the migration-layer instance of a rule already recorded elsewhere in this
file: the applied artefact and the intended artefact are different things, and only
the applied one is true.

---

## Q-40: `check:migrations` reported valid `do $$ ... $$;` as an orphan `$$;`

**Status:** corrected in `tools/check-migrations.mjs`.

**What happened.** Migration 056 opens with an anonymous PL/pgSQL block - `do $$` /
`$$;` - to guard a money operation. That is valid SQL and PostgreSQL applied it
without complaint. `check:migrations` failed it:

    20260930000056_fund_referral_programme.sql     fns= 0 FAIL (1)
        - orphan $$; with no open function (line 97)

The gate paired every `$$;` with a `create or replace function` declaration. It had no
model for a block that is neither, so it reported the closer of a correctly balanced
block as an unmatched delimiter.

**The fix, and why it was not a suppression.** The tempting repair is to ignore a
`$$;` when nothing is open. That deletes the orphan check, and the orphan check is
what catches the truncated-function-plus-duplicated-tail defect this tool exists for
(Q-11) - the failure the tool was written to detect. Silencing it would have turned a
false positive into a false negative and made the gate worse than useless.

Instead a `do $$` opens a tracked block of its own kind, pairs with the next `$$;`,
and carries the same `if`/`end if` balance check a function body does. A genuine
`$$;` with nothing open is still an error.

**Proved both directions, twelve injected cases.** A gate that has never been shown to
fail proves nothing, so each case was injected into a real migration file, the gate
re-run, and the file restored byte-identically:

| Case                                     | Expected | Result |
| ---------------------------------------- | -------- | ------ |
| valid `do $$ ... $$;`                    | OK       | ok     |
| genuine `$$;`, nothing open              | FAIL     | FAIL   |
| unclosed function                        | FAIL     | FAIL   |
| `if`/`end if;` missing inside a DO block | FAIL     | FAIL   |
| unclosed DO block                        | FAIL     | FAIL   |
| two-line `do` / `$$` form, balanced      | OK       | ok     |
| two-line form, `end if;` missing         | FAIL     | FAIL   |
| DO block following a closed function     | OK       | ok     |
| function unclosed, then a DO block       | FAIL     | FAIL   |

One case initially reported WRONG - and the fault was in the fixture, not the gate:
it was labelled "missing `end if`" and contained one. That is the third time in this
repository a proof harness, not the production code, was the thing that was wrong.

**The general point.** `check:migrations` parses files. It cannot know whether a
construct is legal SQL, so every construct PostgreSQL accepts that the tool had not
previously seen is a candidate for a false positive. The response to a false positive
is to teach the gate the construct and prove the new behaviour both ways - never to
widen an ignore list, which converts a loud false positive into a silent hole.

---

## Q-41 - a status word was invented where a database value belonged

**Status:** corrected in CR-0029; the pattern is now a rule.

This is the third occurrence in this repository of a presentation-layer string compared
against a database enum that does not contain it.

| Where             | Invented                                      | Reality                                                    | Visible effect                                            |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| CR-0027 referrals | `reward.state === 'SETTLED'`                  | `reward_state` has `AVAILABLE`, never `SETTLED`            | Available referral money rendered neutral grey            |
| CR-0029 perks     | `paid_order_status.PAID`                      | enum is PENDING, CONFIRMED, FULFILLED, REFUNDED, CANCELLED | Paid orders rendered as **unpaid**                        |
| CR-0029 perks     | response literal `'PAID'`, then `'CONFIRMED'` | a purchase leaves the order `FULFILLED`                    | The API told the client a status the database never wrote |

**Why it keeps happening.** The comparison is always false, so nothing throws. Worse,
the surrounding code is normally _fail-closed_ - an unrecognised status falls through to
a neutral default - and a fail-closed default looks precisely like correct defensive
programming. The result is a green build, a passing suite, and a screen that quietly
misstates a financial state. In the perks case that meant paid money displayed as
unpaid, in a codebase whose central rule is that green means credited money.

**The rule.** Before mapping any database enum to a UI, read the enum from the
migrations:

```sql
select unnest(enum_range(null::app.paid_order_status));
```

Never infer the values from the column name, from the wrapper that returns them, or
from what the word would naturally be called. `SETTLED`, `PAID` and `AVAILABLE` are all
words a careful engineer reaches for, and two of the three do not exist.

**Never report a state the handler did not read.** If `purchase_with_funding` returns a
`spend_events` row and not the order, then the handler has not observed the order's
status and must not report one. Return the identifiers actually held, and let the client
re-read authoritative state.

**Pin the enum in a test.** Export the real values as a constant and assert the display
map covers all of them and invents none, as `ORDER_STATUSES` does in
`src/lib/perks/present.ts`. Then re-inject the invented value and confirm the test
fails. A guard that has only ever passed proves nothing - which is the same rule that
produced Q-40 and Q-39, and the reason this entry is about the pattern rather than the
three individual bugs.

---

## Q-42 - a provider signature was implemented against a guess, and the guess was untested against the vendor

**Status:** resolved in CR-0031, by observation rather than by argument.

CPX's postback signing scheme was undocumented. CR-0030 recorded four external sources
that disagreed:

| Source                        | Claimed scheme                         |
| ----------------------------- | -------------------------------------- |
| One production integration    | `md5(trans_id + secure_hash)`          |
| A second sample               | verifies nothing at all                |
| The largest known CPX network | documents no postback hash             |
| CPX outbound listing docs     | `md5(ext_user_id + '-' + secure_hash)` |

The adapter was written against `md5(trans_id - secure_hash)`, taken from the
publisher's own INFORMATION panel. A live test postback on 2026-10-04 returned
`verification_result = VERIFIED` with `signature_algorithm = md5(trans_id-secure_hash)`,
confirming the hyphen and the transaction-id-only input.

**Why it mattered to write it down.** Every wrong variant fails **closed**, and closed
means every real conversion is silently rejected while the dashboard reads "no earnings
yet". The dangerous property is not that a guess is wrong; it is that a guess and a
correct implementation are indistinguishable until real traffic arrives. A unit test
cannot settle this, because a test written from the same assumption as the code proves
the code agrees with itself.

**The rule.** Where a vendor's behaviour is not documented, prefer a vendor-authored
screen over third-party integration reports, and record which source was used. If the
source cannot be reached, record the ambiguity in a change record rather than resolving
it silently - an unresolved signing scheme is a known unknown, and a confidently wrong
one is not.

**And record what the signature does not cover.** It binds `trans_id` alone. Amount,
status and user are outside the MAC, so a verified callback's amount is authenticated as
"this transaction id exists", not as "this amount is correct". Amount-versus-rate
comparison belongs in reconciliation and must never be described as a cryptographic
check.

---

## Q-43 - a fraud reversal was discarded because it used a status value the vendor did not list in its field reference

**Status:** corrected in CR-0031. Recorded because the pattern is the whole point.

`classifyCpxEvent` matched `status === '2'`. CPX's INFORMATION panel documents
`{status}` as "1 = completed 2 = canceled", and that is what the code was written
against.

A **second advisory panel on the same screen**, visible only on the wider publisher
layout, states:

> Your postback URL will be called by us a second time, as soon as we cancel a
> transaction. &status=1 (pending) to &status=-2 (reversed).

So `-2` is the fraud reversal, arriving 15-60 days after the completion - the single event
this integration exists to catch. It classified as `UNKNOWN`, `conversionStatus` was
null, `handleCallback` returned null, and the reversal was dropped with **no conversion
row at all**.

**Why this is worse than the duplicate case found in the same review.** A reversal
discarded as a duplicate at least leaves the original conversion standing and visible. A
reversal discarded as an unknown status leaves no trace that a withdrawal was ever
offered. With no reward ever having been created, the loss was invisible; the day one
exists, it is a clawback that silently never happens.

**This is Q-41 again, in a provider vocabulary rather than a database enum.** The
comparison is always false, so nothing throws, and the code around it is fail-closed -
which is precisely what made it look deliberate. `SETTLED`, `PAID` and `2`-only were each
a word a careful engineer reached for and each was absent from the real vocabulary.

**The rule, generalised.** A vendor's _reference table_ is not their _wire behaviour_.
Look for the advisory panels, the footnotes and the second notification rules, and
prefer a value demonstrated by observed traffic over a value read from documentation.
Where the two disagree, treat the disagreement itself as the finding.

**Pin the whole vocabulary in a test.** `leaves no documented cpx status unrecognised`
sweeps every status CPX sends against every type and asserts none yields `UNKNOWN`. The
old population sweep used `['1','2','0','x',undefined]` - it omitted `-2`, which is
exactly why the defect survived a green suite. Adding a value to the sweep is what
caught it. Then re-inject the defect and confirm the suite fails.

---

## Q-44 - two integration facts were carried in comments and column names rather than in code

**Status:** both corrected in CR-0031. Grouped because they share one cause.

**The source-IP list was compared against the wrong machine.** `CPX_POSTBACK_IPS` held
CPX's published "Postback Whitelist IP" addresses and was compared against `ip_click`,
which CPX documents as **"user click IP"** - the address of the person who clicked
through to the survey. The comparison was therefore false for essentially every callback
while appearing to be a source check.

The unit test made this worse. It passed a whitelisted address in as `ip_click` and
asserted the result was `true`, so the suite encoded the category error as expected
behaviour and would have failed any attempt to fix it.

The same screen also proved the list is incomplete: the live postback arrived from
`44.204.183.114`, which CPX does not publish. Gating on it would have dropped a real
conversion with no error the provider could act on.

**`provider_callbacks.claimed_event_id` was null on a verified callback.**
`readClaimedEventId` looked only for `event_id`, a generic name CPX does not send; their
transaction id is `trans_id`. The vendor's identifier never reached the evidence column.

**The shared cause.** Both facts lived in a name. `ip_click` looks like a source
indicator and `event_id` looks universal, so neither was read against the vendor's field
list. The corrected code compares the whitelist against the request's `remoteAddress`,
records `ip_click` as the separate fact it is, and falls back to `trans_id`.

**Also corrected here: migration 014's seed comment** asserts "CANDIDATE, is_active is
false". There is no `is_active` column on `app.providers`. It exists on
`deposit_token_configs`, `offers`, `surveys`, `game_events`, `referral_codes` and
`game_achievements`, but not here - so a query selecting it fails with 42703, which is
how this was found. The comment describes a safety property that does not exist, and a
future author could "fix" it by adding the column rather than by removing the claim.
Migration 014 is applied and stays byte-identical; the correction belongs in
`docs/DISCREPANCIES.md` and a forward comment.

**The rule.** Two identifiers from different machines never share a comparison, and a
generic field name is not evidence that a vendor uses it. Read the vendor's field table
before comparing anything to a value in it, and check that the test's fixture places the
value in the field it will actually arrive in - a test that feeds the wrong field asserts
the defect rather than catching it.

## Q-45 - a migration shipped a protection the money path never called

**Status:** corrected. The SQL is applied and stays byte-identical; the fix is a
one-line TypeScript rewire plus a test that pins the wire.

Migration 060 (CR-0033) built `public.resolve_tracking_user_for_attribution` - the
liveness-aware resolver that refuses dead participations - and its header comment
made two claims. Both were false:

1. "Nothing new routes through [the old wrapper]" - in the sense the author meant
   (the old wrapper fades out of use), this never happened.
   `src/lib/providers/ingest.ts` still called migration 034's
   `resolve_tracking_user`, which has no status filter and resolves ANY
   participation row, live or dead. A callback naming a finished participation's
   tracking id still attributed to that user - the exact window the new function
   was written to close. The protection existed in the database and was not
   wired into the path that needed it. Nothing in `src/` called the new
   function at all.
2. "The attribution suite asserts that the new path is the one in use."
   `supabase/tests/provider_attribution.sql` calls the new SQL function
   directly. That proves the function correct, not that the money path reaches
   it. No test covered the TypeScript side.

The old ingest comment compounded this by overclaiming in the other direction:
"a forged callback naming somebody else's tracking id resolves to nobody".
Under the old wrapper that is false for a live participation; under either
wrapper it is false for a VALID, LIVE tracking id of another user.
Unpredictability narrows that window; the settlement gate is what stops money
leaving. Both halves of the comment now say exactly what they mean.

**Verification.** `tests/providers/ingest-attribution.test.ts` proves ingest
CALLS the new wrapper by name, never calls the legacy one (exact equality, not
a substring - the new name contains the old one), and records a null resolution
as `UNRESOLVED_TRACKING_ID` rather than dropping it. The defect was re-injected
(`resolve_tracking_user`) and all three tests fail; restored, all pass.

**The rule.** A comment claiming a path is in use is not evidence it is. When a
new function replaces an old one across a language boundary - SQL one side,
TypeScript the other - no test on either side alone proves the wire. The test
must name the callee the production code actually reaches.

## Q-46 - the only path a provider event becomes money had never been executed by a test

**Status:** corrected by `supabase/tests/provider_live_gate.sql` (34 assertions, green in
a 22-suite / 513-assertion run). No migration and no source file changed.

Found 2026-10-06, during the CPX CANDIDATE->LIVE migration audit: the question "what
happens if `cpx_research` is promoted tomorrow?" has three code answers, and none of
them had behavioural coverage.

1. **`public.apply_conversion_reward`** - migration 015's own header calls it "the ONLY
   place a provider event becomes money". Its entire previous coverage was one grants
   assertion in `providers.sql` (the function exists, and anon cannot execute it). A
   grants test proves who may call; it never proves what happens when they do. The five
   refusals (unknown conversion `23503`; non-VALIDATED status; non-LIVE provider; no
   resolved user; NULL funding source `22004`), the happy path (grant, budget decrement,
   exactly one ledger entry, outbox event, audit event, CONVERTED, PENDING) and
   idempotent replay were asserted nowhere.
2. **`public.list_live_offers()` / `public.list_live_surveys()`** - the earn-page
   listing gate (`is_active AND lifecycle_state = 'LIVE'`, migration 031) had zero
   assertions on either wrapper. A filter that silently stopped filtering would have
   shipped green: every existing test returns the same result either way.
3. **`public.get_active_provider_reward_source()`** - returned an id no test checked.
   Whether an INACTIVE source is refused, and whether an unknown provider code returns
   null (leaving the conversion recorded and UNPAID), was unproven.

This is the same shape as Q-27 and Q-45: coverage that was assumed rather than
exercised, and therefore counted as assurance without being any.

**Verification.** The new suite runs against fixture rows only (`pglive_` provider
codes, one fixture auth user; the deployed `cpx_research` row is never touched). Each
of the five refusal fixtures breaks exactly ONE precondition, in the order the
function checks them, so the exact SQLERRM identifies the rule that fired rather than
whichever PostgreSQL evaluates first (Q-24, Q-27). Every population is counted beside
its gate test - the `0 bad` rule - including a 6-row privilege population with a
service_role control so the zero cannot be vacuous. The happy path captures a ledger
baseline in a temporary table so "+1 entry" counts only its own transaction, and the
replay proves no second spend. Full run: 22/22 suites, 513 assertions, 0 failures.

**The rule.** Grants coverage is not behavioural coverage, and a wrapper with no test
anywhere is indistinguishable from a wrapper tested elsewhere - both read green. Before
trusting a gate, name the test that FAILS when the gate is removed. If no such test
exists, that absence is the finding.

---

## Q-47 - a status filter silently fails on exactly the provider we are waiting for

**Found** 2026-10-07, while building CR-0034b (provisional provider earnings).

**The defect.** The projection that shows estimated provider earnings was first written
with `and c.status <> 'REVERSED'` to exclude reversed conversions. That predicate is
correct for a provider that has ever been LIVE and **wrong for every provider that has
not**, which right now means CPX Research.

`apply_provider_reversal` (migration 057 line 326) has two paths. When the original
conversion already carries a reward, it reverses the reward and updates the original's
status to `REVERSED`. When it does not, it returns early with outcome `no_reward` at
line 337 and **touches nothing**.

Every CPX conversion has `reward_id` null, because `apply_conversion_reward` refuses any
provider that is not `LIVE` (migration 015 line 66). So every CPX reversal takes the
early-return path, and the original conversion keeps reading `VALIDATED` indefinitely.

The practical consequence: CPX re-notifies a conversion with `status=-2` 15-60 days
later, the clawback is recorded correctly as its own row per CR-0032, and the user still
sees the original amount listed as _pending estimated earnings_. The system knows the
money was taken back. The screen says otherwise.

**Why it survived review.** The predicate is the obvious one, it is the one CR-0032's own
comments would suggest on a quick read, and it is correct in the LIVE case that every
existing test covers. Nothing about it is locally wrong; it is wrong _conditionally_, on
the exact path the current provider takes. The unit tests that existed for
`provider_reversal.sql` asserted the reversal ROW was created - which passed - and never
asserted what the ORIGINAL still reads afterwards.

**The fix.** Exclude by the link rather than the status:

```sql
and not exists (
  select 1 from app.provider_conversions r
  where r.reverses_conversion_id = c.id
)
```

The link is the only signal that survives the early return, because it is written by
`record_provider_reversal` before the branch is taken.

**The rule.** A predicate can be correct for the data you have and wrong for the data
you are about to have. When a filter reads a mutable status, ask which code paths leave
that status untouched, and check the filter against the path that runs _today_. Re-injecting
the status predicate produced 6 named failures in `supabase/tests/provisional.sql`.

**A second, smaller instance of the same shape.** `serializeWallet` gained a
`provisionalEarnings` field on `WalletSummary` but not on `WalletSummaryJson`, so the API
route returned an object with no such key and the page silently showed nothing. TypeScript
did not catch it because the function's declared return type was satisfied by the fields
it _did_ set. Adding a field to a read model means adding it to the wire type in the same
commit; the unit test that asserts the serialised key set is what found it.

## Q-48 - the economic simulation specification was never part of the approved baseline

A directory `averrra_economic_sim_spec/` (27 files, `00`–`22` plus a brief, a manifest
and a README) describes a full virtual-economic life simulator replacing the Mining
Game. It was never numbered, never versioned, never indexed, and never referenced by
`82_SOURCE_INDEX.md`. Per doc 78 a specification that sits outside the numbered corpus
is not a source of truth, however detailed it is.

**Decision.** It is classified INPUT, not baseline. It is not adopted wholesale. `88`
and `89` are now the authoritative economic-simulation requirement, and the external
package is subordinate to them. Its conflicts are recorded here rather than resolved by
editing the external files, which are left intact as the source that was reviewed.

## Q-49 - a floating-point price model contradicts an integer money model

`02_GAME_ECONOMY.md` and `12_SECURITY_ANTI_FRAUD.md` of the external spec both require
integer minor units and say "Never use floating point for balances or accounting",
while `03_MARKETS_AND_PRICE_ENGINE.md` defines a multiplicative price recurrence,
`new_price = max(min_price, previous_price * (1 + clamp(r, ...)))`, plus exponential
decay `impact_t = impact_0 * e^(-t/half_life)`. Neither statement can be satisfied by
one storage type: a price that changes by a fraction of a minor unit has no integer
representation, and a balance must not absorb that rounding.

**Decision.** `89` splits the two explicitly rather than picking a winner. Monetary and
accounting amounts are `BIGINT` in minor units. Prices, returns, factors, ratios and
decay coefficients are `NUMERIC(38,12)`. Arithmetic is numeric end to end with no
intermediate rounding and exactly one final rounding step. Adopting either rule alone
would have silently violated the other.

## Q-50 - the market engine assumes a scheduler this repository does not have

`03_MARKETS_AND_PRICE_ENGINE.md` specifies a 60-second tick, clients updated "through
realtime/polling", and "scheduled aggregation jobs". `02_GAME_ECONOMY.md` requires
daily telemetry aggregates. The repository has no cron entry, no `pg_cron` schedule,
no background worker and no queue consumer; the only scheduled surface is the
outbox, which exists to deliver already-committed financial events and is not a
price engine.

**Decision.** V1 is deterministic and lazy-on-read. A price is computed when read, from
(a canonical epoch, tick index, asset, seed), with a fixed stored epoch rather than
wall-clock "now". No scheduler is introduced. The consequence is deliberate: two
servers at the same tick MUST produce the identical price, which is testable, where a
job that may or may not have fired is not.

## Q-51 - the navigation list exceeds the navigation budget actually shipped

`15_UI_UX_AND_NAVIGATION.md` lists eight destinations (Home, Markets, Trade, Wallets,
News, Life, Store, More) and says to "replace the current mining entry" with them. The
shipped application has a header `TopNav`, a six-item mobile tab bar and a `More`
sheet. Eight primary tabs do not fit that budget, and the design system sets a 44px
minimum tap target.

**Decision.** Not resolved by choosing six destinations. The external spec itself
defers: it says to reuse "the existing responsive navigation pattern from AVERRA's
newer navigation work where possible". The game destinations therefore become
game-contextual navigation inside the game shell, not eight global tabs. Recorded in
`88` rather than in `15`, since `15` is superseded and must not be edited further.

## Q-52 - the database schema contract contained no game domain to deprecate

`48_DATABASE_SCHEMA.txt` was searched for `game_` and contains zero matches, even
though the Mining Game has been in production for months with `app.game_players`,
`app.game_achievements`, `app.game_events` and `app.game_leaderboard_entries`. The
contract that defines the production schema never described the largest game domain
in it.

**Decision.** Recorded rather than back-filled. Writing the current mining schema into
`48` would give a superseded subsystem authoritative documentation status, and CR-0035
creates no schema. `48` is amended to state that no simulation table exists yet and
that the domain is deferred to CR-0037 and later.

## Q-53 - the specification proposes a second store beside an existing one

`13_DATABASE_AND_BACKEND.md` defines `app.store_orders`, `app.store_order_items`,
`app.manual_payment_submissions` and `app.store_fulfillments`, and
`10_MONETIZATION_AND_MANUAL_PAYMENTS.md` defines an order lifecycle. AVERRA already has
this domain: `app.paid_perk_products`, `app.paid_perk_orders`,
`app.paid_perk_fulfillments` and the manual-payment-submission table from CR-0017,
together with the funding-spend polarity rule that a funding SPEND is a
`USER_FUNDING_SPEND` DEBIT and never an earned reward.

**Decision.** CR-0042 generalizes the existing machinery. There is no second store, no
second order table and no second payment-order architecture. Adopting the external
names verbatim would have produced two order tables with different state vocabularies
and one ledger, which is the same shape as Q-55 one level up.

## Q-54 - the specification names a table that already exists in the live schema

`13_DATABASE_AND_BACKEND.md` proposes creating `app.game_achievements`. That table was
created by `20260930000021_game_expansion.sql` at line 79 and is live. The same file
proposes `app.game_accounts`, which does not exist (mining uses `app.game_players`),
so the collision is not detectable by pattern alone.

**Decision.** Recorded in `88` section 9 as a hard collision to resolve before any
implementation migration. Adopting the spec as written would have produced a migration
that fails against the deployed database, at a point where a partial series would
already exist.

## Q-55 - the specification defines an order state the live enum does not contain

`10_MONETIZATION_AND_MANUAL_PAYMENTS.md` lists `PAID` among the order states. The live
enum `app.paid_order_status` (migration `20260930000040`, lines 46-52) is `PENDING`,
`CONFIRMED`, `FULFILLED`, `REFUNDED`, `CANCELLED`. There is no `PAID`, and there is no
`REJECTED` either.

**Decision.** The existing enum wins; CR-0042 maps onto it and does not define a second
vocabulary. This is the exact defect class of CR-0029 (Q-41), where comparing a
presentation string against an enum that does not contain it rendered paid money as
unpaid. The failure is silent, so it is recorded here as a named collision rather than
left to be rediscovered during implementation.

## Q-56 - a virtual mint is named after a real-money operation

`13_DATABASE_AND_BACKEND.md` lists a server function `deposit_virtual_cash` described
as "system only". In this repository "deposit" is a loaded real-money term: deposits
post to User Funding Balance only after independent payment verification and authorized
admin confirmation.

**Decision.** A virtual mint MUST NOT be named `deposit`. Recorded in `88` section 9 so
the rename happens before the function is written rather than after it is reviewed.

## Q-57 - price columns are named as minor units but required to be fractional

`13_DATABASE_AND_BACKEND.md` names price columns `open_minor`, `high_minor`,
`low_minor`, `close_minor`, `limit_price_minor` and `price_minor`, while the same
document requires minor-unit integer money and the price engine requires fractional
prices. Across the applied migrations `_minor` is unambiguously `BIGINT`
(`paid_perk_products.price_minor`, `paid_perk_orders.price_minor`, migrations 040 and
043), so a `NUMERIC(38,12)` column carrying that suffix would contradict an existing
convention.

**Decision.** The REQUIRED TYPE wins and the COLUMN NAME gives. `_minor` is reserved
exclusively for `BIGINT` minor-unit amounts; price and rate columns use `_price`,
`_price_num`, `_rate`, `_factor` or the domain term. Recorded in `89` section 4. The
alternative — making all prices `BIGINT` minor units — was rejected because it cannot
represent the external spec's own one-kobo coin price with any meaningful precision.

## Note on the starting balance

`00_MASTER_SPEC.md` states a starting balance of "1,000,000 virtual NGN" and defines the
minor unit as 100 virtual kobo per NGN, but never states the encoded integer. The two
readings differ by 100x. `89` section 7 fixes it at 100,000,000 (virtual kobo). Not
raised as a numbered question because there is no conflict between sources, only an
omission in one of them.

## Q-58 - our own docs asserted the CPX entry link was correct, and it was not

**Found:** 2026-10-07, during CR-0036 (CPX LIVE activation).

`docs/PROGRESS.md` recorded, after CR-0033b:

> "Now we can build the link a person clicks to start a survey, and that link carries the
> tracking code back to us. That is the piece that was missing."

and the earn page rendered `offers.tracking_base_url` directly as an anchor. Both were
true, and both described a link that cannot work.

CPX's current official documentation (`https://cpx-research.com/main/en/doc.php`,
IFRAME TAG section) requires `app_id` and `ext_user_id` on **every** entry method and
states that `ext_user_id` "will also be used for postback/s2s/webhook communication".
`createTrackingLink` set `subid_1` and nothing else, and the raw base URL carried no
parameters at all.

With no `app_id`, CPX cannot tell which app a click belongs to, so **no click was
attributable to Averra**. A per-click tracking id inside it does not help, and the link
returned HTTP 201 throughout, so every layer reported success.

**Why this survived four CRs and a live postback.** Every gate that ran said the work was
done: typecheck, lint, build, all four structural lints, 397 unit tests, and a pgTAP
suite proving the LIVE machinery end to end. The tests were the actual problem - see
below. Nothing in the repository ever compared our outbound link against the vendor's
documented one, because CR-0030 had correctly recorded that the **postback** format was
undocumented, and that finding was then over-generalised to the whole integration.

**Two distinct lessons.**

1. _A test that encodes a defect is worse than a missing test._ The old
   `createTrackingLink` assertions checked that `subid_1` was present. They passed, and
   they passed **against a link that cannot work** - they asserted the defect rather than
   the contract. CR-0036 rewrote them against the vendor's documented URL, and proved the
   rewrite by removing the `app_id` line and confirming three named failures before
   restoring.

2. _Fixture-only tests cannot detect a provider that is never enabled._
   `provider_live_gate.sql` proves the LIVE machinery using `pglive_live`, and
   deliberately never touches real rows - so every one of its assertions stayed green
   while `cpx_research` sat at CANDIDATE for its entire life. `cpx_live.sql` (CR-0036) is
   the first suite to assert against the real seeded provider, and it will fail if CPX is
   deactivated without thought.

**Also recorded:** CPX's documentation covers the ENTRY link in public but describes the
postback only inside the publisher dashboard. "Undocumented" was true of the postback and
was wrongly assumed true of the integration.

**Resolution.** Migration 065 removes `href` from `public.list_live_offers` and the earn
page now opens offers through `POST /api/providers/offers/[id]/click`, which mints the
participation from the verified session. See `docs/change-records/CR-0036-cpx-live-activation.md`.

## Q-59 - the settlement gate had no reachable entry point

**Found:** 2026-10-07, during CR-0036.

`app_private.settle_provider_period` (migration 059, amended by 061) is the ONLY reachable
path from a provider conversion to an `AVAILABLE` reward, and
`transition_reward_ungated` is revoked from every role including `service_role`. That is
the CR-0033 design working exactly as intended.

But PostgREST resolves an RPC only against an EXPOSED schema, and `app_private` is not
exposed. So the function was **unreachable**: nothing could call it. Migration 058 added
wrappers for the reversal commands for precisely this reason, and nobody noticed the
settlement command had none.

**Why it was invisible.** It could not matter until a provider went LIVE, because
`settle_provider_period` only acts on `CONVERTED` conversions carrying a reward, and no
reward existed. Every reward test in the corpus used a fixture provider and asserted the
PENDING outcome - which is the correct assertion about the GATE and says nothing about
whether the gate can be opened.

**The failure it would have caused.** The moment CPX went LIVE, real rewards would be
created at PENDING with no way to release them, and the only remedy an operator would
reach for is a manual `UPDATE ... set state = 'AVAILABLE'`, which bypasses the
reconciliation entirely. The gate that took two releases to build would have been the
thing that got disabled, by the pressure of an apparently stuck balance.

**Resolution.** Migration 065 adds the single-statement `public` wrapper, revoked from
`public`/`anon`/`authenticated` and granted to `service_role` only, with the
`transition_reward_ungated` revoke re-asserted in `cpx_live.sql`. A related gap in the
same migration: `app.offers` and `app.surveys` seed none of the fourteen CANDIDATE
providers, so even a LIVE provider with no row would show nothing - and `cpx_live.sql`
asserts the CPX offer exists for that reason.

## Q-60 - the settlement gate made money correct but not durable

**Found:** 2026-10-10, during CR-0037.

Research into CPX publisher behaviour resolved the long-standing `status=1` question
(`docs/PROGRESS.md`): `status=1` means CPX logged the completion, **not** that the
provider will pay. The advertiser decides validity, and CPX's publisher terms give
the advertiser a **60 to 90 day window** to devalidate it retroactively.

That is not a UI wording problem. It is a settlement cycle that outlives ours, and it
contradicts an assumption the schema had been making since CR-0033.

**The defect.** `settle_provider_period` is the only reachable path to `AVAILABLE`, and
its only period check was `p_period_end <= p_period_start`. Nothing required the period
to be OLD. Composed with four existing behaviours:

1. `post_ledger_entry` raises rather than let a user-facing balance go negative (`004`).
2. Reserving a withdrawal DEBITS `EARNED_REWARD`, taking it to zero (`007`).
3. `reverse_reward` reverses by DEBITING `EARNED_REWARD` in full (`010`).
4. No maturity check on settlement (`059`).

So a reversal arriving after the user withdrew **cannot execute at all**:

```
Day 7    period settled; reward AVAILABLE
Day 8    user withdraws; EARNED_REWARD debited to 0
Day 75   advertiser devalidates; CPX re-notifies status=-2
         -> DEBIT EARNED_REWARD -> would be -NGN 500 -> RAISES -> aborts
```

`evidence.ts` records `REVERSAL_APPLY_FAILED`, so it is visible - but CPX's dashboard
shows the clawback **delivered** and the money is gone. No `debt`, `recovery`,
`overdraft` or `write_off` mechanism exists anywhere in the schema (grepped: zero
hits), so the loss is permanent, not deferred.

**Why it was invisible.** Every reversal test in the corpus reverses a reward that is
still `PENDING` and still holding its balance. That is the only case that works, and it
is the case least likely to occur in production the moment a provider settles on any
real cadence. CR-0033 verified the gate was _correct_ at the moment of release; nothing
ever checked that the release was still reversible a quarter later.

**Why this is not a "provider problem".** CPX behaved correctly throughout: the
advertiser devalidated, and CPX notified. The defect is ours - we released money on a
cycle shorter than the vendor's right to take it back.

**Resolution.** Migration 066 requires `p_period_end <= now() - interval '90 days'`
before any reward may be released, anchored on `period_end` because that bounds the
_youngest_ conversion in the period. Deliberately not configurable: a tunable window is
a defect one `UPDATE` from returning. The cost is real and stated plainly - users wait
~90 days longer to be paid - and it was chosen over paying users and being unable to
take the money back. See `docs/change-records/CR-0037-settlement-maturity-gate.md`.

**Consequence for go-live.** The first settlement for any new provider is delayed ~90
days past its first conversion, and any report covering a period that ended less than
90 days ago is now refused with `period_end is inside the 90-day maturity window`.
`docs/outreach/cpx-go-live-confirmation.md` has been updated, because its request for
"our first real settlement report" cannot now be satisfied at go-live.

## Q-61 - `rate_limited` is a declared error code that nothing ever returns

**Found:** 2026-10-10, while answering CPX's partner-review fraud-prevention question.

CPX's integration review asks what fraud controls exist. Answering that question meant
auditing what is actually enforced rather than what the codebase declares - and the
first gap was in our own HTTP envelope.

`src/lib/api/errors.ts` declares `rate_limited` in the error-code union and maps it to
HTTP 429. A repository-wide search finds exactly those two lines. **No route handler
returns it**, and there is no rate-limiting middleware anywhere in `src/`.

Three separate reasons this is worse than dead code:

1. **It reads as implemented.** A reader of `errors.ts` sees a 429 and concludes there is
   a limiter. There is not one. This is the doc 71 failure mode applied to our own code -
   the repository describing a control it does not have.
2. **`errors.ts` is the single place an operator looks.** It is the natural answer to
   "what is our rate-limiting posture", and it currently answers wrongly.
3. **The fraud detectors do not compensate.** `TASK_VELOCITY`,
   `WITHDRAWAL_VELOCITY`, `DEPOSIT_VELOCITY` and `PROVIDER_CALLBACK_VELOCITY` detect
   abuse _after the fact_, by counting committed rows in a window. A limiter prevents
   request volume. Neither substitutes for the other, and describing the detectors as
   rate limiting would be exactly the overstatement to avoid.

The same audit found a second, related gap: `PROVIDER_CALLBACK_VELOCITY` is seeded into
`app.risk_detector_config` (migration 029) but has **no implementation** in
`detect_risk_signals`. The seeded row implies a control that does not run. The other
five seeded detectors - `DEVICE_CLUSTER`, `TASK_VELOCITY`, `GAME_VELOCITY`,
`WITHDRAWAL_VELOCITY`, `DEPOSIT_VELOCITY` - were each verified to query a real table.

**Not yet fixed.** Both are recorded here rather than silently patched, because a rate
limiter is a design decision with real trade-offs (per-route limits, trusted-proxy
handling for client IPs, whether limits apply per user or per session) and the
`provider_callback` limit has to be chosen against CPX's legitimate retry behaviour.
Neither is a one-line change.

**Why it is recorded anyway.** CPX's review is a real audit that will be repeated, and
the honest answer to "what is your rate-limiting posture" is currently "none". Better to
know that before the question is asked than to have discovered it then.

---

## Q-62 - the fraud detectors are granted but never called

Found 2026-10-10 while auditing platform claims for CPX's partner review. Recorded here
because the review is a real audit and the honest answer to "are your detectors running"
was currently "no".

**What was claimed.** A draft partner response described "five behavioural detectors -
device clustering, task velocity, game-action velocity, withdrawal velocity, deposit
velocity - with tunable thresholds", under a heading about monitoring in place.

**What is true.** `app_private.detect_risk_signals` (migration 029) is well built and
was verified against real tables. It is also **unreachable from the running
application**:

- no caller anywhere in `src/` (searched for `detect_risk_signals` and
  `record_task_signal`);
- no `public` wrapper, so PostgREST cannot resolve an RPC against an unexposed schema -
  the same trap as Q-59;
- granted to `service_role`, which grants a permission, not a caller.

A related gap: **no client collects a device fingerprint at all**, so `hash_observation`
(a correct SHA-256 path that stores only the digest) currently has no input. "Device
identifiers are hashed before storage" was therefore true about the hashing and silent
about the absence of identifiers.

`PROVIDER_CALLBACK_VELOCITY` is the sixth seeded row and, per Q-61, has no
implementation at all.

**Why this is the same defect as Q-59.** There, `app_private.settle_provider_period` was
the only path to AVAILABLE and had no reachable entry point, so a PENDING reward had no
release. Verifying the function's _logic_ was sound and said nothing about whether it
could _run_. Here the logic is sound and nothing invokes it.

The generalisation, and the fourth time this repository has learned it: **a control is
defined by a reachable call path, not by an accurate function body.** Checking that a
function queries a real table proves the logic works. It does not prove anything executes.

**Status.** Not fixed. Wiring the detectors means deciding when they run - per request,
per completed task, or on a schedule - and a scheduled detector needs a worker that does
not exist yet. That is a design decision, not a one-line change. The partner response was
corrected to say the detectors exist but are not yet invoked.

**Also fixed here.** `NEXT_PUBLIC_SITE_URL` is now declared in `.env.example` and
required by `src/lib/env.ts`. The referral page built its share link as
`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/sign-up?ref=CODE`, which silently degraded to
a relative path that does nothing once pasted into a chat app - a referral acquisition
link that is dead in production and throws no error. Same shape: a missing thing that
looks fine until someone follows it.

## Q-63 - `.env.example` declared `NEXT_PUBLIC_SITE_URL` twice, and the empty copy won

Found 2026-10-09 while preparing the design-system phase of the paid-perks work.

**What was claimed.** `.env.example` is the template an operator copies to `.env.local`.
Q-62 fixed a genuinely dead referral link by making `NEXT_PUBLIC_SITE_URL` required, and
the fix added the variable to `.env.example`.

**What is true.** The variable was added **twice**, four lines apart:

    NEXT_PUBLIC_SITE_URL=https://your-domain.example
    NEXT_PUBLIC_SITE_URL=

dotenv resolves a duplicate key to the **last** occurrence, so the empty line wins. Every
operator who copied the template got an empty site URL - which is precisely the failure
Q-62 had just fixed, reintroduced by the file meant to prevent it. The declaration is the
one variable in the template whose comment explains that it must not be empty, and it was
the only one shipped empty.

**Why it survived a real fix.** The Q-62 change was verified against `src/lib/env.ts`,
which correctly fails loudly on an empty value. That check runs against whatever the
operator actually has in `.env.local`, so it never inspects the template. The defect is
in the template, and nothing in the repository reads `.env.example`.

**Status.** Fixed. The duplicate declaration is removed and the reason is recorded inline,
so the next edit to that line knows why it must stay singular. There is no automated gate:
nothing parses `.env.example`, the same class of gap as `.github/workflows/` in Q-30.

**Also found in the same file.** `.env.local` carries a `CPX_STATS_API_KEY` that appears
nowhere in `src/`, nowhere in `tools/`, and nowhere in `.env.example`. It is read by
nothing, so it is a stored secret with no consumer. Not added to the template: documenting
a variable that no code reads would make the template lie in the other direction.

## Q-64 - a change record asserted that dark theme tokens exist, and they do not

Found 2026-10-09 while determining how the brand logo should render across themes.

**What was claimed.** `docs/change-records/CR-0004-design-system-ui-refresh.md`, final
bullet: "The dark theme tokens are defined but not yet wired to a theme switch."

**What is true.** There are no dark theme tokens. Enumerating the population rather than
grepping a guess at it: `src/` contains exactly **1** CSS file, `globals.css`, which
contains exactly **1** `@theme` block, and across every `.css`, `.ts` and `.tsx` file in
`src/` there are **0** matches for `prefers-color-scheme`, `data-theme`, `.dark`,
`@custom-variant` or `darkMode`.

The claim is wrong in a way that changes the work rather than merely the documentation.
"Defined but not wired" describes a half-finished job: find the tokens, add a switch. The
truth is that the entire theme layer must be **written**, including the part the record
implies already exists. Budgeting Phase 2 as "flip the switch" would have produced a
half-dark system discovered in the browser.

**Status.** Corrected. Dark theme is built from scratch: switchable colours move out of
compile-time `@theme` into plain `:root` / `[data-theme]` custom properties remapped via
`@theme inline`, because a value read from `@theme` at build time cannot be switched at
runtime. This is recorded as a correction forward rather than an edit to CR-0004, per the
applied-record rule.

**Built 2026-10-09 (CR-0040 follow-on).** The layer described above now exists and is
wired: colours live in `:root` and `[data-theme='dark']` and are mapped through
`@theme inline`, an inline bootstrap script in `<head>` writes `data-theme` before first
paint, and Settings carries a Light/Dark/System control. Verified against the BUILT
stylesheet rather than against the source: `.bg-surface` compiles to
`background-color:var(--surface)` and `.text-ink-900` to `color:var(--ink-900)`, so the
utilities resolve at paint time and the dark block is actually reachable. A source-level
check would have passed either way. The entry stays open as a record of what CR-0004
claimed.

**Scope boundary.** Light/Dark ships as a free accessibility pair following
`prefers-color-scheme`. It is deliberately **not** the paid theme perk:
`app.paid_perk_kind` includes `'THEME'` (migration 040), and docs 83 and 84 both treat
premium themes as monetised. An accessibility light/dark pair is not that perk, and
multiple decorative themes stay unbuilt and reserved for the entitlement work.

## Q-65 - two distinct financial states render as one indistinguishable badge

Found 2026-10-09 in the design-system component layer, unrelated to the theme work that
surfaced it.

**What is true.** `PILL_TONE` in `src/components/ui/Card.tsx` defines:

    warning: 'bg-gamify-400/30 text-gamify-600'
    gamify:  'bg-gamify-400/25 text-gamify-600'

A 30% versus 25% alpha difference on the same hue, with identical text colour. And
`STYLE` in `src/components/ui/MoneyState.tsx` maps **both `eligible` and `reserved` to
`pill: 'warning'`**. So "Verified and owed to you, but not yet released" and "Held by an
in-flight withdrawal" render as the same badge.

This is doc 09 TRANSPARENCY failing in the presentation layer. Those two states are the
difference between money you are owed and money that is already spoken for, and the user
cannot tell them apart. The surrounding text hints do differ, so the information is
present - but a badge is what a user reads first, and the component that exists to make
financial state unambiguous is the component that flattens it.

**Related.** `gamify` is reserved for XP, levels, streaks and badges per doc 47, and
`warning` is borrowing it. That also means a non-financial state and a financial one share
a colour, in the direction doc 47 forbids.

**Also found: the whole system bypassed its own tokens.** Searching for the vendor
palette rather than for my own token names returned **20 occurrences across 13 files** -
`bg-red-50`, `text-red-700`, `border-red-200` - in error pages, both auth forms, both
wallet forms, both support forms, the review form, the game shell, and three components of
the design system itself. The file documenting "no hardcoded hex values in components" was
asserted by a gate that passed.

**Status.** Fixed, in three parts.

1. Semantic scales added to `@theme`: `danger` (the only red family), `warning` (orange,
   hue ~55-68, deliberately set below gamify's gold at ~80-92), and `locked` (cool slate,
   hue ~250) for money that is real, credited and already claimed by a withdrawal.
2. `PILL_TONE` now separates by **hue and treatment**, not by a five-point alpha change:
   `warning` and `locked` carry a ring, `gamify` is a flat tint.
3. `STYLE.reserved` moved from `warning` to `locked`, so "owed to you" and "already
   claimed" can no longer share a badge.

All 20 vendor-palette occurrences were replaced with `danger-*` equivalents, 1:1 on the
shade rather than approximated - `danger-200` and `danger-900` were added to the scale
specifically so the mapping did not have to round.

**The gate.** `tests/ui/design-tokens.test.tsx` now asserts BOTH rules, and the second
one reads source, because a behavioural test cannot tell `bg-danger-100` from `bg-red-100`

- they render identically. Only the absence of a vendor palette from files whose job is to
  use ours is assertable by reading them. It reports its population (`99 scanned, 0 bad`)
  and has a guard test asserting it scanned more than 50 files, so the walk cannot silently
  return nothing and pass vacuously - the Q-22 failure mode.

## Q-66 - `?error=toString` on the sign-in page crashed the page

Found 2026-10-09 while writing the regression tests CR-0040 left outstanding.

**What was true.** The sign-in page mapped `searchParams.error` through an allowlist:

```ts
const AUTH_ERRORS: Record<string, string> = {
  auth_callback_failed: 'That sign-in link could not be completed. …',
  otp_expired: 'That verification link has expired. …',
};
const message = code
  ? (AUTH_ERRORS[code] ?? 'We could not complete that sign-in. Please try again.')
  : null;
```

The `??` fallback reads as exhaustive. It is exhaustive only over the keys somebody
imagined, because `AUTH_ERRORS` is an **object literal** and therefore inherits from
`Object.prototype`:

```console
> A = { auth_callback_failed: 'x' }
> A['constructor']
[Function: Object]
> A['constructor'] ?? 'FALLBACK'
[Function: Object]
```

Every inherited member is a defined, non-nullish property, so `??` never fires for any of
them. `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__` and
`__defineGetter__` all resolve to a **function**, the fallback is skipped, and the
function is handed to React as a child - which throws.

**Reachability is what makes this a defect rather than a curiosity.** It is one query
string: `GET /sign-in?error=toString` is a crash, not a rendering oddity. Nothing about
it looks like an attack in a log, and the user simply gets a blank page after following a
legitimate-looking link.

This is the same failure family as the `safeNext` defect fixed one layer over in the same
change record - a check that reads as total and is only total over the cases its author
considered - and the same family as the Q-22 leak check, where a predicate that matched
zero rows was reported as a security assurance.

**Status.** Fixed. The allowlist moved to `src/lib/auth/errors.ts` (a page is an async
Server Component that calls `getSessionUser()` and `redirect()`, so an allowlist declared
inside it was untestable) and the lookup became an own-property test:

```ts
if (!Object.hasOwn(AUTH_ERROR_MESSAGES, trimmed)) return AUTH_ERROR_FALLBACK;
return AUTH_ERROR_MESSAGES[trimmed];
```

`Object.hasOwn` asks whether the allowlist really declares this code, rather than whether
some property somewhere resolves to it.

**The gate.** `tests/auth/sign-in-errors.test.ts` asserts all nine prototype keys resolve
to the fallback as a string. Per the rule that a test must be shown to fail: the `??` form
was re-injected, the suite produced **10 named failures**, and the file was restored.

## Q-67 - white text on `--brand-500` is below WCAG AA for body-size text

Found 2026-10-09 while defining the dark scheme, and left unfixed deliberately.

**What is true.** `--brand-500` is `oklch(0.63 0.19 150)` in the light scheme and is held
at exactly the same value in dark - a deliberate decision, since the vivid green is the
brand and a brand that changes colour when the OS does is not a brand. Three components
put white text directly on it:

- `Card tone="brand"` - `bg-brand-500 text-white`, at body sizes
- the active `PillTabs` tab - `bg-brand-500 text-white text-sm font-semibold`
- `BrandLockup`'s mark - `bg-brand-500 text-white font-black`

White on `oklch(0.63 0.19 150)` lands around **3.1:1**. WCAG 2.2 AA requires 4.5:1 for
normal text and 3:1 only for "large" text, which means 24px, or 18.66px when bold. A 14px
semibold button and the brand card's body copy are neither.

**Why it was not fixed here.** Every fix is a brand decision, not an engineering one:

1. Darken `--brand-500` far enough for white to pass - it stops being the vivid green the
   whole design system and the `DESIGNS/` references are built on.
2. Change the foreground to `--brand-900` - the green on green loses the pill treatment
   that the "active tab" affordance depends on.
3. Keep `--brand-500` as an accent for icons and borders only, and introduce a distinct
   darker `--brand-solid` for solid surfaces carrying text.

Option 3 is the correct one and it is a two-token change plus a sweep, but it changes how
the brand reads, which is not a call this change record should make unilaterally.

**Status.** Open. No component was changed. Recorded so it is not rediscovered as a
contrast-audit finding later and mistaken for a new defect.

## Q-68 - the supplied logo cannot be used, and it is not this brand's colour

Found 2026-10-09 while consolidating the brand lockup.

**What was supplied.** `AVERRA_LOGO.png`, one file, 1254 x 1254. It is a **presentation
mockup**, not a production asset, and three independent facts each rule it out on their own:

1. **It is a full lockup on an opaque near-black square**, not a square mark. The mark
   appears above the wordmark "AVERRA" and the tagline "EARN · PLAY · GROW". Placed in a
   32px header the wordmark becomes an unreadable smear, and the near-black background
   renders as a visible dark block on every light surface in the application.
2. **Its gradient is blue to purple.** Every colour token in the design system is green -
   `--brand-500` at hue 150, the active tab, the settled-money badge, the `DESIGNS/`
   reference direction recorded in `globals.css`. Dropping this file into a component
   ships a second, competing brand identity.
3. **There is no transparent-background export and no vector.** Rasterising to 32px
   destroys exactly the ribbon-fold detail that makes the mark recognisable, which is the
   one thing a small mark has left.

**Why this was not "fixed" by generating an SVG.** A plausible-looking vector "A" would be
an invention of brand identity presented as an asset, which doc 78 forbids in the same way
as inventing a token contract address. Worse, it would be indistinguishable from a
delivered mark at review time, and nobody would be able to tell which parts of the brand
were designed and which were reconstructed by an engineer on a deadline.

**Status.** Deferred, with the refactor done so that landing the real asset is a one-file
change. The lockup was duplicated verbatim in four places - the app shell, sign-in,
sign-up and the marketing header - and four copies of a brand mark is four chances to
drift, with a brand that is correct in three places and slightly wrong in the fourth
reading as intentional. All four now render `<BrandLockup>` from
`src/components/brand/BrandLockup.tsx`, which keeps the token-driven mark the application
has always shown.

**What the designer needs to supply**, for the swap to be complete:

- a square mark on a **transparent** background, as SVG (not PNG), that works at 32px
- a lockup with the wordmark as **live text or outlined vector**, not rasterised
- a **monochrome** variant for favicon and app-icon use
- a decision on **green versus the blue/purple gradient** in AVERRA_LOGO.png, and if the
  gradient wins, a matching revision to `--brand-*` in `globals.css`

Until then `BrandMark` stays token-driven, so it is correct in both light and dark and
never diverges from the palette.

## Q-69 - a raw NUL byte made a test file binary to git

Found 2026-10-09, incidentally, while reading `git diff --stat` at the end of CR-0040.

**What was true.** `tests/auth/next.test.ts` contains a corpus of hostile `next` values
that `safeNext` must reject, including one with an embedded control character. It was
written with a **literal U+0000 byte** rather than the escape sequence:

```
'/ //evil.com',        <- contains a raw NUL, not the six characters \u0000
```

The test is correct and has always been correct - the JavaScript string genuinely
contains U+0000, and `safeNext` rejects it via a control-character class. Nothing was
broken at runtime.

**Why it still mattered.** A raw NUL in a source file causes git to treat the whole
file as binary:

```
 tests/auth/next.test.ts | Bin 3251 -> 3160 bytes
 1 file changed, 0 insertions(+), 0 deletions(-)
```

So the file stopped appearing in code review. Every future change to the redirect
allowlist - the single most security-relevant helper in the auth path - would have
shown up as `Bin NNN -> MMM` and been unreviewable by default. Typecheck, lint and the
suite were all green, because a NUL is a legal character in a string literal.

It is also invisible in the editor: nothing renders where the byte is, so the line
reads as `'/ //evil.com'` - a string that is easy to misread as whitespace.

**Status.** Fixed. The literal is now the six-character escape sequence. Identical
runtime value, same coverage, and the file is text again. Confirmed by sweeping every
`.ts`, `.tsx` and `.css` file under `src/` and `tests/`: zero NUL bytes remain.

**A second instance, in PRODUCTION code, found by the same sweep.** After the first was
fixed, a byte-level sweep of `src/`, `tests/` and `docs/` found two raw **U+0007 (BEL)**
characters in `src/app/(app)/earn/page.tsx`:

```ts
// .from('offers'). The <BEL>pp schema is not exposed through the Data API.
// The wrappers already join <BEL>pp.providers and filter on lifecycle_state =
```

BEL renders as nothing, so those lines read as "The pp schema" and "join pp.providers" -
a garbled reference to `app.providers`, in the two comments that explain why the earn
page must not call `.from()` directly. That is the Data API rule of doc 82, and its
explanation had been quietly corrupted in a way that reads like a typo rather than a
signal. This file was not binary to git, so nothing would ever have surfaced it.

Both bytes are now `a`. The sweep reports zero control bytes across every `.ts`, `.tsx`,
`.css` and `.md` file under `src/`, `tests/` and `docs/`.

The general rule this is an instance of: **a byte that a tool cannot render is a byte
a reviewer cannot see.** Escape anything below U+0020 in source, always. The cheap
detection is not a lint rule - it is `git diff --stat` printing `Bin` where text was
expected, and a byte scan, which is why the sweep was worth running at all.

## Q-70 - a Server Component called a function from a `'use client'` module

`src/app/(app)/earn/page.tsx` built its tabpanel's `aria-labelledby` by calling
`pillTabId()` and `pillTabPanelId()`, imported from `@/components/ui/PillTabs`.
`PillTabs.tsx` is a `'use client'` module, so those are client references in a Server
Component, and the page threw on every render:

    Attempted to call pillTabPanelId() from the server but pillTabPanelId is on the
    client. It's not possible to invoke a client function from the server.

**Why every tool passed it.** `tsc`, `eslint`, all 654 vitest tests and `next build`
each resolve the module correctly; the call is legal TypeScript and legal at compile
time. Only a render executes it. This is the same shape as the `checkOutParameterReturns`
defect in Q-17 - a tool that resolves a definition without executing the thing the
definition promises.

**How it happened.** Fixing the inert-`PillTabs` defect (CR-0040) required shared id
helpers, because the tabs and their panel are rendered in two different files and a
drifted id is a broken `aria-controls` that looks perfect. The helpers were exported
from the client module, which is where they were implemented, and the Server Component
called them from there.

The fix moved them to `src/components/ui/pillTabIds.ts` with no directive, and added
`npm run check:server-imports`.

**The trap in fixing the import path.** `export { pillTabId } from './pillTabIds'`
inside `PillTabs.tsx` re-wraps them as client references and restores the crash
exactly - while looking like the tidier diff, because it keeps both call sites
unchanged. Do not do that.

**Two boundaries the gate must not cross, or it is unusable within one commit:**

- It must not fail on *importing* a client reference. `<PillTabs />` imported into a
  Server Component is the intended App Router pattern.
- It must not fail on `import type`, which erases at compile time and is how every
  Server Component types its props.

The general rule: **a value exported from a `'use client'` module is a proxy object in
a Server Component, not a function.** Rendering it is legal; calling it is not. A pure
value belongs in a module with no directive.
