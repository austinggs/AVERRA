# AVERRA - INSTRUCTIONS FOR AI AGENTS

Last reviewed: 2026-09-30
Authority: AVERRA_FULL_PLAN/71_ARCHITECTURAL_LAWS.md, 78_AI_DEVELOPMENT_RULES.md, 79_AGENTS.md

This repository is the Averra earning and rewards platform. The specification corpus in
AVERRA_FULL_PLAN/ is the source of truth. This file tells an agent how to work here.

## Source-of-truth hierarchy (doc 82)

Architectural Laws > Approved System Specs > Database/API Contracts > Acceptance
Criteria > Implementation Phases/Milestones > Existing Code > Tests > Progress Notes >
AI assumptions.

Never silently override the hierarchy. If spec and code disagree, record it in
docs/DISCREPANCIES.md and follow the more authoritative source.

## Read before editing

AVERRA_FULL_PLAN/71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, the relevant domain doc,
48_DATABASE_SCHEMA.txt, 49_API_SPECIFICATION.txt, 70_ACCEPTANCE_CRITERIA.md, and
docs/change-records/ + docs/DISCREPANCIES.md. Inspect existing code and tests first.
Make the smallest coherent change.

## Non-negotiable invariants (doc 71)

- Financial state is server-authoritative. Frontend state never authorizes money.
- Every financial mutation produces an immutable ledger entry.
- Provider callbacks are authenticated, validated and idempotent.
- Every reward has a traceable funding source.
- Reversals are compensating entries; history is never rewritten.
- Fraud controls may hold or reject, but never silently alter financial history.
- Earned Reward Balance and User Funding Balance are separate domains. A deposit never
  becomes an earned reward.
- The Mining Game server is authoritative; game resources are not money.
- Analytics are never financial truth.

## Hard prohibitions

- No AI-generated customer-support replies. Production support is 100% human.
- No AI-authored moderation decisions and no AI financial decisions.
- No client-side credit, confirmation, or balance mutation. Ever.
- No secret in client code. SUPABASE_SECRET_KEY is server-only; never prefix it
  with NEXT_PUBLIC_.
- Never invent Celo token contract addresses. All four tokens (USDT, USDC, USDm, USAT)
  seed inactive with no address until RPC-verified. Native CELO is never accepted.
- Never edit AVERRA_FULL_PLAN/ ad hoc. It is an approved baseline: patch it through a
  change record (doc 81) and bump the document version.
- Never let Prettier or a formatter touch AVERRA_FULL_PLAN/ (.prettierignore protects it).

## Commands

npm run dev # local dev server
npm run build # production build
npm run lint # eslint
npm run typecheck # tsc --noEmit
npm test # vitest
npm run test:db # pgTAP suites against SUPABASE_DB_URL; needs no Docker
npm run test:db:cli # supabase test db (pg_prove; needs Docker or a linked project)
npm run e2e # playwright
npm run db:push # apply migrations to the linked database
npm run db:types # regenerate database types
npm run check:bundle # scan the built client bundle for leaked secrets
npm run check:migrations # structural lint of PL/pgSQL migrations (needs no database)
npm run check:data-api # fails on any direct .from() read or write of an app table
npm run check:grants # fails if a public function never revokes EXECUTE from anon

A change affecting money, identity, providers, payouts, deposits or game authority
requires targeted regression tests before it is considered done.

## Validated toolchain decisions (do not "upgrade" blindly)

- TypeScript is pinned to 6.0.3, NOT 7.x. typescript-eslint (bundled by
  eslint-config-next 16.3.8) hard-refuses TS 7.0: "typescript-eslint does not support
  TS 7.0". Typecheck works under TS 7 but lint cannot run.
- ESLint is pinned to 9.39.5, NOT 10.x. ESLint 10 breaks the typescript-eslint scope
  manager: "TypeError: scopeManager.addGlobals is not a function".
- eslint-config-next 16.3.8 is flat-config native (exports Linter.Config[]); no
  FlatCompat shim is needed.

## Secrets

.env.local holds live credentials and is gitignored. supabase.md is gitignored.
Never commit them, never log a key, never paste a key into documentation.
If either file is ever exposed, rotate SUPABASE_SECRET_KEY and the database password.

## Architecture note

All application and financial tables live in the app schema, which is deliberately
NOT exposed through the Supabase Data API. RLS is enabled everywhere as defence in
depth. Privileged work runs through server-side code plus SECURITY DEFINER functions
in app_private, with a transactional outbox written in the same transaction as any
state change. See docs/adr/.

## Repository map

- `supabase/migrations/` - the authoritative schema, 001-034.
  001-004 foundation, capability model, ledger; 005-006 deposit and withdrawal
  tables; 007-008 withdrawal and deposit commands; 009-010 reward engine and
  commands; 011-012 notifications and support; 013 outbox claiming and
  completion; 014-015 providers and the provider reward bridge; 016-017 native
  task tables and commands; 018-020 Mining Game foundation, commands and seed;
  021-022 game expansion and commands; 023-024 referrals; 025 advertisers;
  026-027 fraud risk and moderation; 028 the risk gate on the reward engine;
  029 signal detectors; 030-031 the bounded `public` READ wrappers; 032-034 the
  missing `app_private` COMMANDS (deposit submission, provider callback evidence,
  provider conversions). 035 the public entry points for those 26 commands, because
  PostgREST can only resolve an RPC against an exposed schema. 036 the revocation of
  the anon EXECUTE grant on 29 wrappers. Money moves ONLY through `app_private` functions.
  037-039 campaign billing polarity and the reviews system. 040 the paid perks,
  entitlements and donations tables; 041 the funding-spend commands and the three
  bounded read wrappers. A funding SPEND is a USER_FUNDING_SPEND DEBIT and never an
  earned reward; a donation record is acknowledgement and posts no ledger entry.
  057-058 append-only provider reversals. A provider withdrawal is its OWN conversion row
  carrying a suffixed event identity, never an update to the completion. 059-062 the
  settlement gate: AVAILABLE is unreachable except through a MATCHED provider settlement,
  `expected_*` is computed rather than trusted, and tracking ids are server-minted CSPRNG.
  063 tracking-link issuance: the destination comes from OUR offer row and the wrapper
  refuses any offer whose provider is not LIVE, so issuance is built but inert.
  064 provisional provider earnings: a READ-ONLY projection of estimated earnings from
  non-LIVE providers. No table, no ledger entry, no reward, no payout. It exists so a
  CANDIDATE provider's real callbacks are visible without becoming money.
- `supabase/tests/` - pgTAP suites (546 assertions, 23 files). Executed and green as
  of CR-0034b; run them with `npm run test:db`, which needs no Docker. Earlier they had
  NEVER run, and every one of them held at least one defect. Each suite declares its OWN
  `begin;` - the runner does not add one. Every suite ends with
  `select * from finish();`, NOT a bare `finish()`.
- `tools/run-db-tests.mjs` - the live pgTAP runner. Fails on a suite that produced no
  assertions, and on a plan that does not match the count executed.
- `src/lib/auth/` - verified session and capability guards. Fail-closed.
- `src/lib/api/` - route wrapper, error envelope, actor-scoped idempotency keys.
- `src/lib/contracts/states.ts` - mirrors the database state enums.
- `src/lib/financial/` - pure, testable money arithmetic (fee, withdrawal).
  Computes and validates; never mutates state.
- `src/lib/wallet/` - reads both balances as separate collections.
- `src/lib/observability/` - structured logging, business metrics, outbox processor
  and handlers. `payload.ts` is pure and unit tested; the rest are server-only.
- `src/lib/tasks/` - pure mirrors of the doc 12 verification rules, for honest UI
  copy. It decides nothing; the database is the authority.
- `src/lib/game/scene.ts` - pure scene model for the Mining Game client: placement,
  visual intent, and the version guard. A WebGL canvas cannot be unit tested, so
  every decision with arithmetic in it lives here instead. `interpolatedEnergy` is
  the one place a client clock touches a number, and it is clamped twice.
- `src/components/ui/` - the design system. `MoneyState` is the one that
  matters; see below.
- `src/lib/deposits/config.ts` - the ONLY source of the supported-token allowlist.
- `src/lib/supabase/` - browser, server, proxy and admin (service-role) clients.
- `docs/adr/` - architecture decisions. `docs/change-records/` - what changed and
  why, per doc 81.

## Design system rules

The visual direction came from the shots in `DESIGNS/`: a vivid green, pill
controls, generous radii, large numerals, mobile-first with bottom tab
navigation. The layout and composition are our own, not a reproduction.

- **Tokens live in `globals.css`,** as CSS custom properties under `@theme`.
  There are no hardcoded hex values in components.
- **Financial state is never styled by the caller.** Render amounts through
  `MoneyState` or `BalanceCard`, which derive colour and label from the state.
  `settled` is the only state that earns the brand green, so a green number
  always means credited money. Doc 09 TRANSPARENCY lives in this component, not
  in each page.
- **`--color-gamify-*` is reserved for XP, levels, streaks and badges** and must
  never be used for a financial amount, so a virtual reward cannot be mistaken
  for money (doc 47 SEPARATION).
- **A claim is never described as a payment.** Use `describeRewardState` from
  `src/lib/tasks/contract.ts` for task attempt wording.
- **The Supabase admin client is loosely typed.** A `.select()` naming a column
  that does not exist will NOT fail typecheck; it fails at runtime. Check the
  migration before selecting a column. `offers` and `surveys` do not share
  column names.
- Tap targets are at least 44px, focus rings are always visible, and interactive
  elements carry an accessible name.

## Native task verification rule

Doc 12 says a client completion claim is evidence only. That is enforced in four
places, and all four must stay in place:

1. `task_definitions_paying_task_needs_verification` - a paying task must declare
   a verification mechanism, so no unverifiable payout exists in the schema.
2. `task_definitions_self_attested_never_auto_verifies` - a `SELF_ATTESTED` task
   can never set `auto_verify = true`.
3. `verify_task_completion` re-checks both rules at the point of decision, so a
   caller cannot bypass the constraints by ignoring them.
4. `submit_task_completion` has no path to money. It records evidence and sets
   `SUBMITTED`. The reward is created only by `grant_reward` inside
   `verify_task_completion`.

`src/lib/tasks/contract.ts` mirrors rules 1 and 2 for UI copy. It is never an
authority. If it ever disagrees with the database, the database wins and the
mirror is the bug.

## Environment configuration

`src/lib/env.ts` and `src/lib/env.server.ts` validate LAZILY, on first use, not
at module import. This is deliberate: `next build` collects page data in a worker
whose environment is not the runtime environment, so import-time validation broke
the build with a misleading "Failed to collect page data" error. Fail-fast is
preserved where it matters. Do not "tidy" this back into a module-scope throw.

## Change record

- CR-0001 - V7 documentation canonicalization (the audit findings).
- CR-0002 - Phase 0 foundation, financial schema and command functions, plus the
  auth, HTTP surface and Reward Engine addenda.
- CR-0013 - Removal of every direct `app`-schema Data API access, the bounded
  `public` wrapper surface, and the three missing `app_private` commands.
- CR-0016 - Reviews and community system (doc 86).
- CR-0017 - Paid perks, donations and the funding-spend path (doc 83).
- CR-0020 - Mining Game Three.js rendering layer (doc 17, 31). Additive: `GameShell`
  remains the single action path and was not modified.
- CR-0021 - Review authoring commands and the reply outbox (doc 86). Migration 042.
- CR-0032 - Append-only provider reversals. Migrations 057/058.
- CR-0033 - Settlement-gated attribution. Migrations 059-063.
- CR-0034 - Responsive navigation. CR-0034b adds provisional provider earnings,
  migration 064: a read-only projection of estimated earnings from non-LIVE
  providers. No table, no ledger entry, no reward, no payout.
- CR-0035 - Economic simulation baseline. Documentation only: docs 88 and 89 added,
  docs 15-34 superseded and retained verbatim. Mining is DORMANT, not removed; only
  CR-0045 may retire it, and only after CR-0036 audits its data.

## A provider withdrawal is a new row, not an UPDATE

The rule that took three releases and a live postback to learn.

CPX Research re-notifies a transaction when it detects fraud 15-60 days later, sending the
**same `trans_id`** with `status=-2`. Law 5's unique index on
`(provider_id, provider_event_id)` therefore returned the **original** conversion as a
`DUPLICATE`, so the clawback was discarded with no reversal row, no `reverse_conversion`
call, and no error anywhere - while the vendor's dashboard showed the reversal delivered.

The obvious fix, letting the reversal `UPDATE` the original's status, is a financial
rewrite (law 42). So the reversal is **its own conversion row**, with its own event
identity and a `reverses_conversion_id` link.

Three consequences, each of which will look like an unnecessary complication until one
day it is not:

1. **The suffix is part of the vendor value, verbatim.** `trans_id:-2` and `trans_id:2`
   are distinct identities because CPX distinguishes `2` (cancelled) from `-2` (reversed).
   A numeric comparison conflates them. And it is deterministic, so a provider that
   re-notifies the same withdrawal still collapses onto the same row.
2. **The link names the BARE `trans_id`.** The suffixed id exists only on the reversal;
   the lookup searches for the completion.
3. **The reversal inherits no user.** `user_id` and `tracking_id` are null. It withdraws
   a conversion, it does not attribute a new one.

Two ordering rules that are easy to get wrong and were both wrong here:

- **Reversal handling goes BEFORE the duplicate early-return.** Re-notification is the
  common case, so a branch placed after the duplicate check silently no-ops on every
  replay.
- **The lifecycle gate must not rewrite the vendor's status.** `p_status` was computed as
  `mayConvert ? 'VALIDATED' : 'RECEIVED'`, which recorded a reversal as `RECEIVED` - a
  live-looking value. The gate governs whether an event may become _money_; it has no
  business rewriting what the vendor asserted.

**Do not add a parameter to an existing command to carry this.** The first attempt
appended `p_reverses_event_id` to migration 034's `record_provider_conversion`, and
`check:migrations` refused the build: migration 035 is a `public` PostgREST wrapper that
calls it with 14 positional arguments, so a 15th parameter compiles and then fails at
runtime. Migration 034 stayed byte-identical and a separate command was added. See
`docs/change-records/CR-0032-append-only-provider-reversals.md`.

## `plan()` must be the first statement, and `col_is_fk` is not portable

Four pgTAP facts that each cost a run against the deployed database. All are asserted in
`supabase/tests/provider_reversal.sql`.

1. **`select plan(n)` must precede EVERY assertion.** Placed after the first assertion,
   the whole suite failed as `produced no assertions at all` - which reads like a suite
   that never ran rather than an ordering mistake.
2. **`col_is_fk` and `has_check` are absent from the deployed pgTAP build**, and their
   arity varies between versions. Assert the same property with a query against
   `pg_constraint` instead; it is version-proof.
3. **`pg_constraint.consrc` was removed in PostgreSQL 12.** Use
   `pg_get_constraintdef(oid)`. Note the extra parens it emits around a top-level `OR`.
4. **`null_value_not_allowed` is a condition NAME for SQLSTATE 22004**, not a distinct
   code. pgTAP compares the resolved SQLSTATE, so writing the name never matches, and a
   blank-string rejection is 22004 rather than `null_value_not_allowed`.

## The runner's rollback protects a PASSING suite only

`tools/run-db-tests.mjs` wraps each suite in `begin; ... rollback;`. A suite that
**errors** mid-way leaves its fixture rows committed - the transaction is already
aborted, so the rollback restores nothing. Three aborted runs left three partial
fixtures, and the next run then correctly reported the completion as a `DUPLICATE`.

That is the worst shape a test failure can take: a failure caused by the _previous_
failure, which reads as a real defect and invites someone to "fix" working code. Any suite
that creates rows should delete its own prefix before it starts, and a leaked fixture is
evidence about the suite that leaked it, not about the code under test.

## AVAILABLE is settlement-gated, and the gate is a revoke

Before CR-0033, `app_private.transition_reward` placed **no condition on `AVAILABLE`**.
Migration 015's comment claimed a conversion "settles via transition_reward once
settlement is confirmed" - that was a wish, not code. Any caller with EXECUTE could make
a PENDING provider reward withdrawable before the provider paid.

The fix closes the path from the OUTSIDE, using the CR-0028 `grant_reward` /
`grant_reward_ungated` shape:

- `transition_reward_ungated` holds the original body, **revoked from every role
  including `service_role`**. This is the whole point: a `create or replace` under a new
  name is a RENAME and carries the original ACL with it, so
  `revoke ... from public, anon, authenticated` alone leaves `service_role` holding
  EXECUTE and the gate is decorative.
- `transition_reward` refuses `AVAILABLE` unconditionally - no parameter exists that
  could wave it through, because there is no parameter at all.
- only `settle_provider_period`, which demands a MATCHED settlement, reaches AVAILABLE.

Asserted in `supabase/tests/provider_attribution.sql` for all three application roles,
**and** it asserts those three roles still exist, so the check cannot pass vacuously if
the list is later narrowed. `postgres` / `supabase_admin` are deliberately excluded: they
own these tables and bypass ACL regardless of `rolsuper`, so asserting otherwise would be
asserting something PostgreSQL does not promise.

Verified by re-injection into the live database: re-granting EXECUTE, and reducing the
gate to amount-only, both fail named assertions.

## A partial settlement is not a settlement

A report of 100 against our 90 settles **nothing**. Pro-rating would mean deciding which
ten are real, and no evidence we hold distinguishes them. Holding money is recoverable;
releasing money we cannot account for is not.

Both the amount **and** the count must match. An amount that agrees while the count does
not means our records describe a different set of events that totals the same - which is
exactly what a forged conversion looks like from the settlement's side.

`reconcile_provider_period` counts **CONVERTED** conversions only. Including `RECEIVED` or
`VALIDATED` would report a variance every time we correctly declined to pay something,
and a reconciliation that cries wolf is one nobody runs. Excluding `REVERSED` is what
makes a forgery surface as a variance rather than being quietly absorbed.

## A vendor that signs only its transaction id cannot authenticate attribution

CPX signs `md5(trans_id + secure_hash)`. `subid_1` is **not covered by the signature**, and
their `trans_id`s are sequential and therefore guessable. So the signature says who SENT
the callback, never WHOSE click it was.

Two mitigations, and the honest split between them:

- **Unpredictable tracking ids** (`av_` + 128 CSPRNG bits, server-minted) raise the cost.
  A client may never choose one - a client-chosen id is a sequential id by another name.
- **The settlement gate** is what actually prevents money leaving.

Unpredictability alone is NOT authentication. A forged `subid_1` naming a real, live
tracking id still resolves to that user. Do not describe it as if it does not.

## pgcrypto is in `extensions`, not `pg_catalog`

On Supabase, `gen_random_bytes`, `digest` and friends live in a schema literally named
`extensions`. A function with `set search_path = app, pg_catalog` therefore cannot see
them.

Migration 060 called `gen_random_bytes(16)` under exactly that search_path. It **applied
cleanly**, every structural gate passed, and the function was dead on arrival. plpgsql
bodies are not validated at CREATE, so the failure is deferred to first execution - which
makes it the same class as the "language sql cannot reference a later-created table" rule,
one step further out. Only a pgTAP assertion that actually **called** the function found
it.

A lint cannot see a missing schema in a search_path. Only execution can.

## A suite must declare its OWN `begin;`, and the runner does not add one

`tools/run-db-tests.mjs` does **not** wrap a suite in a transaction. Every suite declares
its own, and `rollback;` without a preceding `begin;` is a **no-op PostgreSQL accepts
silently**.

`provider_reversal.sql` shipped that way in CR-0032, so its fixture was committed to the
live database on **every green run**, and three `pgtap-%` conversions accumulated. It was
found only because a later suite counted rows in a table it had not written to.

New suites must open with `begin;` before `plan()`, and end with `finish();` then
`rollback;` as the final statement. Check with:

    Get-ChildItem supabase/tests/*.sql | ForEach-Object { $c=Get-Content $_.FullName -Raw; if($c -notmatch '(?m)^begin;'){ $_.Name } }

## An append-only table blocks its own cascade

`app.reward_state_transitions` is append-only via `reject_mutation`, and
`ON DELETE CASCADE` from `app.rewards` fires that trigger too. So a leaked fixture reward
**cannot be removed by any test suite at all** - the cleanup statement fails, the suite
aborts, and the rollback that would have cleared it never runs.

Cleaning one required a scoped, transactional
`alter table ... disable trigger trg_reward_state_transitions_immutable`, the deletes,
then re-enable before commit. Verify afterwards:

    select tgenabled from pg_trigger where tgname = 'trg_reward_state_transitions_immutable';

Expect `O`. This is another reason the `begin;` matters: a suite that cannot clean up
becomes permanently unrunnable, not merely noisy.

## The reply outbox event is a trigger, on purpose

Migration 039's `submit_review_comment` writes no outbox event, so there was
nothing to notify from. The obvious fix is to `create or replace` that function
and add the insert - which means retyping an eighty-line body that is already
applied and reviewed. Do not do that. Migration 042 uses an `after insert` trigger
instead: it is additive, it fires in the same transaction by construction, and
migration 039 stays byte-identical.

Three rules the trigger must keep. Each is asserted in
`supabase/tests/review_authoring.sql`, so removing one fails a named test:

1. **No self-notification** - and the suite carries a CONTROL assertion that a
   different user's reply _does_ enqueue, so "zero" cannot pass just because the
   trigger never fires.
2. **The payload carries no comment text.** The comment is still PENDING when the
   trigger runs, so its content is unmoderated (doc 86 PRIVACY).
3. **The recipient is the review author**, taken from the database, never from a
   caller.

## Three.js renders, it never decides

Doc 17: "Three.js renders client presentation and interaction; it does not
authoritatively decide inventory, rewards, progression, or energy." The mining
game therefore has two layers over one snapshot: `GameScene` draws, and
`GameShell` owns every action. Do not "simplify" by having the canvas issue a
game action - that would create a second path to a mutation, and the state
version guard in `src/lib/game/scene.ts` exists precisely because late responses
must not overwrite newer authoritative state.

`interpolatedEnergy` looks like money being computed in the browser. It is not,
and it must never become so: the server recomputes energy on every action, so
the function is a display-only ease clamped to `energyMax` and floored at the
stored value, with a five-minute cap on the preview window. Removing either
guard fails a named test in `tests/game/scene.test.ts`.

## The risk gate wraps the money path; it is not a second money path

`grant_reward` is now a thin `SECURITY DEFINER` wrapper that consults
`reward_blocked_by_risk` and then calls the original, renamed
`grant_reward_ungated`. Two things must stay true:

1. **Never call `grant_reward_ungated` directly.** It is revoked from every role
   including `service_role`, because a rename carries the original `grant
execute` with it. A pgTAP test asserts that.
2. **Never re-type the body of `grant_reward_ungated` to "simplify" it.** The wrap
   exists so the money logic is byte-identical to what was reviewed.

A non-ALLOW risk decision blocks a new credit _before any write_, so a blocked
reward leaves no ledger entry, reward row or budget movement. The gate never
reverses an existing reward; that would be a financial rewrite, which law 42
forbids.

## The app schema is not readable through the Data API

`createAdminClient()` is a PostgREST client, and the `app` schema is deliberately
NOT exposed through the Supabase Data API. A `.from('some_app_table')` therefore
queries `public.some_app_table` and fails with PGRST205 **even when every
migration is applied**. This is NOT a missing-migrations problem.

Do NOT "fix" this by adding `app` to the Data API's exposed schemas. That makes
every table reachable through PostgREST and turns a deliberate decision into a
config toggle someone could flip by accident. If a page needs a new read, add a
wrapper function; if it needs a new write, add a command function.

**`npm run check:data-api` fails the build on any direct `.from()` of an `app`
table.** It harvests the table names from the migrations, so it cannot rot the
way a hardcoded list would. When it fires, the fix is a wrapper or a command,
never a suppression.

Reads go through named `public` SECURITY DEFINER wrappers (migrations 030, 031,
032, 034) and writes through `app_private` commands (032, 033, 034). All are
revoked from `public`/`anon`/`authenticated` and granted to `service_role` only.

Four rules for writing a new one:

1. **Scope by the session user id, never a request-body id.** A wrapper taking
   `p_user_id` plus a record id must filter on both, so another user's record
   reads as absent rather than forbidden.
2. **Filter and cap in SQL, and filter BEFORE the cap.** "The 50 newest unread"
   is not "the 50 newest, of which some are unread".
3. **Return the narrowest shape that does the job.** A wrapper too narrow to
   complete the task is how people end up reading tables directly; a wrapper that
   returns a budget balance is a leak. `list_deposits_awaiting_review` is the
   worked example of the first, `get_active_provider_reward_source` of the second.
4. **Prefer returning a BOOLEAN to returning a row** when the caller only needs
   to know whether something is theirs. See `owns_my_deposit`.

Twelve such call sites shipped before the gate existed, six of them writes. The
most serious was an INSERT into `app.provider_callbacks`, which meant **no
provider callback evidence was ever recorded** despite the table's own comment
promising otherwise. See `docs/DISCREPANCIES.md` Q-13.

## A language sql function cannot reference a later-created table

PostgreSQL validates a `language sql` body at CREATE time, so referencing a
not-yet-created table fails immediately with 42P01 and aborts the whole
migration. `language plpgsql` bodies are not validated until first execution, so
only SQL-language functions are affected. `npm run check:migrations` enforces
this ordering.

## AGENTS.md rule: an applied migration is frozen

`supabase_migrations.schema_migrations` records a migration by **version only**. It
never compares file contents, so a version already recorded is skipped by `db push` -
correctly, and silently. Editing an applied migration therefore changes the file
without changing the database, and the push still prints `Finished supabase db push`.

This happened during CR-0027 (see `docs/DISCREPANCIES.md` Q-39). Typecheck, lint,
`check:migrations`, `check:grants` and every pgTAP assertion passed, because **all of
them read the file on disk and none of them ask the database what was applied.**

The rule:

- **Never edit a migration that has been applied.** It is the authoritative record of
  what the database received.
- **Correct one with a NEW migration.** Leave the applied file byte-identical and
  `create or replace` the definition forward. Both paths then converge, which is what
  makes the correction safe in either order.
- **If the applied file is genuinely wrong as written**, that is a record worth
  keeping. The original stays as the historical evidence; the fix goes forward.

When a migration touches something the UI reads, verify against the deployed
database rather than trusting the push output:

```sql
select proname, prosrc from pg_proc where proname = 'the_function';
```

A structural lint parses the file. It cannot know what was applied, so it cannot
detect this class of drift - the `0 bad` empty-population failure one level up.

## Read the enum before you map it to a screen

Three times now, a presentation string has been compared against a database enum that
does not contain it: `reward.state === 'SETTLED'` (CR-0027), `paid_order_status.PAID`
and a response literal of `'PAID'`/`'CONFIRMED'` (CR-0029). Each comparison is always
false, so nothing throws, and each sat next to fail-closed handling that made it look
deliberate. The visible result in CR-0029 was **paid money rendering as unpaid**.

```sql
select unnest(enum_range(null::app.paid_order_status));
```

Read that before writing a display map. Do not infer values from the column name or
from what the word would naturally be called - `SETTLED` and `PAID` are both words a
careful engineer reaches for and neither exists. Never report a state a handler did not
actually read back, and pin the real enum in a test that has been shown to fail.
See `docs/DISCREPANCIES.md` Q-41.

## Risk and moderation are separate decision systems

Doc 58 SAFETY BOUNDARY states fraud/risk enforcement and content moderation are
"related but distinct decision systems". They are separate tables
(`risk_decisions` vs `moderation_items`) with separate states, reasons and
reviewers, and a pgTAP test asserts neither references the other. Conflating them
would let a content takedown become a fraud hold.

## Risk decisions never rewrite financial history

Doc 40 FINANCIAL INTEGRITY: risk decisions "may hold or reject future events but
must not silently rewrite financial history". Enforced two ways:

- `record_risk_decision` has no parameter through which a caller could ask it to
  move money, and a pgTAP test inspects `pg_proc.prosrc` for any money primitive.
- No column on `risk_signals` or `risk_decisions` could hold or alter a financial
  amount, and a test asserts that against `information_schema`.

A decision is append-only. An appeal adds a NEW row via `superseded_by_id`; the
original is never edited.

## Database tests (pgTAP) - read this first

`npm run test:db` runs `tools/run-db-tests.mjs`, which connects to
`SUPABASE_DB_URL` and executes `supabase/tests/*.sql`. It exists because
`supabase test db` needs Docker, Docker was unavailable, so the ten suites went
unexecuted for the life of the project - and EVERY one of them held at least one
defect. `npm run test:db:cli` is the canonical pg_prove path when Docker or a
linked database is available.

The runner reads `SUPABASE_DB_URL` from the process environment ONLY. It does not load
`.env.local`, so in a fresh shell `npm run test:db` prints
`SKIP ... a skip, not a pass` and exits 0 instead of failing; export the URL first.
Export the POOLER string, never the direct one: `db.<ref>.supabase.co` has been
IPv6-only since January 2024 and a GitHub-hosted runner is IPv4-only, so the direct
form dies with `getaddrinfo ENOTFOUND` before one assertion runs. Note that
`supabase/.temp/pooler-url` holds that host with NO password, while `.env.local` holds
the password against the direct host, so neither file alone is usable. See Q-16.

Two properties of pgTAP itself cost most of that time. Both are properties of the
tool rather than of the tests, and both explain why the suites now read as they do.

### `throws_ok` compares the expected error message by EXACT equality

`throws_ok(sql, errcode, errmsg, description)` requires `SQLERRM = errmsg`
character for character. It is NOT a pattern match, so
`throws_ok(sql, '23514', 'some_constraint', ...)` can never pass: the real
`SQLERRM` is the whole sentence.

    new row for relation "task_definitions" violates check constraint "task_definitions_paying_task_needs_verification"

Measured against the deployed extension on 2026-10-02:

| expected `errmsg`         | result |
| ------------------------- | ------ |
| `null` (errcode only)     | ok     |
| the full `SQLERRM`        | ok     |
| the constraint name alone | not ok |
| `.*constraint_name.*`     | not ok |

The last row is the one that matters. An errcode plus `null` passes, and it is
tempting because it is short, but it is a much weaker assertion: most checks in
this schema are `23514`, and one table carries several of them, so an errcode
alone is also satisfied by the WRONG constraint on the same table. Write the whole
message; the constraint name inside it is what identifies which rule fired.

Do NOT "tidy" these back into bare constraint names. `tasks.sql` test 6 and
`risk_moderation.sql` test 10 were each written to prove one rule while actually
reporting a different one, and only the full message made that visible.

### `pg_enum.enumlabel` is type `name`, and casting it to text carries collation C

    -- FAILS: could not determine which collation to use for string comparison
    results_eq($$ select array_agg(e.enumlabel order by e.enumsortorder)::text $$,
               $$ values ('{A,B}'::text) $$)

`name` has collation C. The `::text` cast carries C onto the result, and the
literal on the right has the database default (`en_US.UTF-8`). PostgreSQL refuses
to guess between two explicit collations. Compare the labels as `name[]`, which is
what they are:

    results_eq($$ select array_agg(e.enumlabel order by e.enumsortorder) $$,
               $$ values ('{A,B}'::name[]) $$)

`is()` tolerates the `::text` form and `results_eq()` does not, which is why some
vocabulary assertions passed all along while their `results_eq()` twins failed.
Adding `collate "C"` to both sides also works; `name[]` is preferred because it
removes the cast instead of overriding the collation.

### A fixture must make the assertion reachable

An assertion that cannot fail is worse than a missing one, because it is counted as
coverage. Four in this corpus could not fail:

- a statement selecting from an EMPTY table (`... from app.referral_codes limit 1`)
  inserted zero rows, so `throws_ok` recorded "no exception";
- a NULL foreign key (`(select id from app.game_missions limit 1)`) died on NOT NULL
  (23502) long before the rule under test;
- two fixtures broke two constraints at once, and so reported whichever PostgreSQL
  evaluates first - not the rule they were written to check.

The order in which PostgreSQL enforces things is what makes a fixture honest:

    1. NOT NULL     (23502)  enforced first, while the row is built
    2. CHECK        (23514)  enforced next, in constraint-NAME order
    3. FOREIGN KEY  (23503)  checked LAST, after the row is written

So a fixture may put a random uuid in an FK column and still reach the CHECK it
means to test - but only if every NOT NULL column is supplied.
`payout_destinations.account_identifier` was not, and that assertion never ran.

### The runner fails loudly, and that was proven

`tools/run-db-tests.mjs` prints the population beside the bad count and treats a
suite that produced no assertions as a FAILURE, so a suite that silently stops
running cannot pass. Three defects were injected to prove it reports them, and the
suite was restored byte-identically afterwards:

- one failing assertion (plan adjusted to match) -> exit 1, `1 failed assertion(s)`
- a suite with no assertions at all -> exit 1, `produced no assertions at all`
- a SQL error mid-suite -> exit 1, reported while STILL showing the assertions that
  had already passed

That third case is why TAP is collected per statement. Run as one batch,
node-postgres discards every result when the batch throws, so a suite with one bad
statement would have printed `ok 13/13` and looked green. Each suite also gets its
OWN connection: every suite is `begin; ... rollback;`, an error aborts the
transaction, and ten suites down one connection would turn one real failure into
ten.

## Editing SQL migrations - read this first

An editor call with an absolute `insert_line` offset can split a PL/pgSQL function
body in half, because the offset is computed against a stale view of the file.
Two migrations were silently corrupted this way (see Q-11 in docs/DISCREPANCIES.md).
The failure is INVISIBLE to a delimiter count, because the orphaned tail usually
restores an even number of `$$` and `end if;` pairs.

Rules:

- Prefer replacing a unique marker string over `insert_line` with a line number.
- After ANY edit to a migration, run `npm run check:migrations` before believing it.
- That gate pairs each function declaration with the next `$$;` and fails on an
  unclosed function, an orphan close, or a duplicated tail. Count-based checks
  are not sufficient.
- **`do $$ ... $$;` is a valid block, not a function.** The gate models it as an
  opening construct that pairs with its own `$$;` and carries the same
  `if`/`end if` balance check. Added for migration 056, which guards a money
  operation inside an anonymous block; the gate previously reported its `$$;` as an
  orphan. Do NOT "fix" this by ignoring a `$$;` when nothing is open - that check is
  what catches the truncated-function defect the tool exists for (Q-11).
- A generated column expression may only reference columns of its OWN row. Referencing
  another table's column fails at CREATE TABLE with 42703; use a trigger.
- An aggregate `filter (where alias.col ...)` requires `alias` to be bound by a
  from or join in the same query, or it fails with 42P01.
- An `out`/`inout` parameter IS the function's result type, not an extra channel
  beside it. Declaring one alongside `returns <scalar>` fails at CREATE with
  42P13. Return a composite or a single jsonb.

## A function in `public` is BORN executable by an unauthenticated user

This is the rule that was learned from a live breach, not from documentation.

PostgreSQL grants `EXECUTE` to the `PUBLIC` pseudo-role on every new function by
default. Supabase's default ACL for schema `public` additionally grants `EXECUTE`
to `anon` and `authenticated`. So a function in the exposed schema is reachable
by anyone holding the publishable key **unless it explicitly revokes**.

A `grant execute ... to service_role` does **not** remove that. Only the revoke
does. Every function in `public` therefore needs, in this order:

```sql
revoke all on function public.foo(...) from public, anon, authenticated;
grant  execute on function public.foo(...) to service_role;
```

29 wrappers from migrations 030/031 shipped without it. `get_wallet_summary`,
`list_my_deposits`, `list_my_notifications` and others returned `200` to an
unauthenticated caller. Migration 036 closed it. See Q-22.

`revoke ... from public` is load-bearing and refers to the **pseudo-role**, not
the schema. Dropping that word leaves the function reachable.

Run `npm run check:grants` in CI. It fails the build when a `public` function has
no revoke, when the revoke omits `anon`, `authenticated` or `public`, or when a
`grant execute` precedes the `revoke`. It was verified by re-injecting each
defect, and against the existing migrations, which it reports clean.

### Scoping by user id is not access control

`get_wallet_summary(p_user_id)` filters by `p_user_id`, so one user cannot read
another's wallet. That prevents **cross-user** access. It does nothing about
**unauthenticated** access, because an attacker supplies any UUID they like.

Both properties are needed. A wrapper can be perfectly scoped and still be an
open door, and a "leak check" that only tests scoping will report it as safe.

### A security assertion must count its whole population

The leak survived several rounds of verification because every check filtered the
population before counting it. `get_wallet_summary` has no `my` in its name, so a
query matching `'get_%' and '%my_%'` never saw it — and the result, zero rows,
was reported as a security assurance.

The rule: **enumerate the population, then filter.** Always report the total
alongside the bad count, so a predicate that silently matches nothing is visible
(`38 total, 0 bad`) rather than invisible (`0 bad`).

This is now the third gate in this repository to fail that way — after the
aliased-column resolver, which false-positived, and the OUT-parameter check,
which false-negatived. The difference is that the other two were lints; this one
was a claim about money made to the user.

## A lint that has never been shown to fail proves nothing

`check:migrations` passed migration 034, which stopped the entire push with
42P13 on its first execution. The five existing structural checks pair delimiters
and blocks; a signature that is syntactically perfect and semantically
contradictory passes all of them. See `docs/DISCREPANCIES.md` Q-17.

`checkOutParameterReturns` was then written to catch it, and **the first version
of that check did not work.** It sliced the source from `close + 1` and then
required a literal `)` in the match, but `close` is the index OF the closing
paren, so the slice consumed the character the pattern was looking for. It
matched nothing, ever, and reported `ok` on the defect it had just been written
for.

It was caught only because the defect was re-injected and the gate re-run again.

**So: before trusting a new check, prove it fails on the defect it was written
for.** Re-inject the bug, confirm the gate reports it, then restore. A green run
on correct input is the weaker half of the evidence and is the half people
remember to check. The same rule is why the CR-0013 `check:data-api` gate was
verified against a deliberately reintroduced `.from('referrals')`.

This is the same warning as the aliased-column resolver below, arrived at from
the opposite direction. That one false-positived. This one false-negatived.
Neither should have shipped on a clean run alone.

## A lint that false-positives is worse than no lint

An aliased-column resolver was written and then REMOVED. It tried to verify that
`alias.column` references in a query resolve to a real column by building a schema
index across all migrations. On this codebase it produced 21 false positives in
`get_wallet_summary` alone, because `b` and `r` are CTE aliases and a regex
cannot see that `from balances b` rebinds the name.

Do not re-add it without first proving it reports zero errors on the existing
migrations. A noisy lint gets ignored, and once ignored it would also mask the
real defects the other five checks catch.

## `.github/workflows/` has no local gate, and `secrets` cannot gate a job

`lint`, `typecheck`, both test runners and all five `check:*` gates operate on
`src/`, `supabase/` and `tools/`. **Nothing in this repository parses
`.github/workflows/ci.yml`**, so a workflow defect is invisible until GitHub
rejects the run. One did exactly that. The `db-tests` job was gated with

    if: ${{ secrets.SUPABASE_DB_URL != '' }}     # INVALID

The `secrets` context is not available to `jobs.<job_id>.if`. GitHub does not treat
that as false - it refuses the whole workflow file:

    The workflow is not valid. .github/workflows/ci.yml (Line: 51, Col: 9):
    Unrecognized named-value: 'secrets'.

So that guard would not have skipped one job; it would have stopped CI from running
at all, including `verify`. `secrets` IS available to `jobs.<job_id>.steps[*].if`
and to `env:`/`run:`, so a presence test belongs in a step. It is now a shell test
that emits a `::warning` annotation when the secret is absent, because a step that
quietly does nothing is the same `0 bad` failure mode as the empty population.

The general rule: a YAML condition that can never be true and one that is not even
legal are equally invisible to a green local run. Check workflow expressions against
the context-availability table, not against intuition. See `docs/DISCREPANCIES.md`
Q-30.

## A status filter can be correct and still fail on today's data

The single most useful finding of CR-0034b, and the one most likely to be repeated.

`apply_provider_reversal` has two paths. If the original conversion already carries a
reward, it updates the original's status to `REVERSED`. If it does not, it returns
early with outcome `no_reward` and **touches nothing**.

Every CPX conversion has `reward_id` null, because `apply_conversion_reward` refuses
any provider that is not LIVE. So `status <> 'REVERSED'` - the obvious filter, and
correct in every LIVE-provider case - **excludes nothing at all** for the provider we
are actually waiting for. A reversed conversion keeps reading `VALIDATED` forever and
the user is shown a clawback as still-pending earnings.

The reliable signal is the LINK: a conversion that someone else's reversal points at.

Three rules:

1. **Ask which paths leave a status untouched.** A predicate on a mutable column is
   only as good as the code that maintains that column, and "no code updates this" is
   not the same as "this cannot happen".
2. **Prefer the immutable fact over the derived one.** A foreign key written at record
   time survives every branch. A status is a summary of a path taken.
3. **Test the filter against the data that exists NOW, not the data the docs
   describe.** The LIVE-provider case was well covered and passing throughout.

Re-injecting the status predicate produced 6 named failures. See
`docs/DISCREPANCIES.md` Q-47.

Related and cheap: `bigint` arrives from PostgREST as a **string**, never a number.
`typeof x === 'number' ? BigInt(x) : 0n` silently yields zero for every real row and
never throws. Normalise both shapes.
