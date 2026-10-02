# CR-0013: Data API read/write removal and the `public` command surface

Date: 2026-10-01
Status: applied to migrations 030-034 and 22 source files. Database execution
still pending: `db:push` has not been run against the linked project, so none of
the SQL in 032, 033 or 034 has been parsed by PostgreSQL.

## What this changes

Every direct `.from()` access to an `app`-schema table is gone from `src/`. In
its place there are bounded, service-role-only `public` wrappers for reads and
`app_private` commands for writes.

The `app` schema is not exposed through the Supabase Data API, so every one of
those call sites was failing at runtime with PGRST205. Six of them were WRITES,
which means the platform has never actually recorded provider callback evidence,
never recorded a deposit submission, and never recorded a provider conversion.

## Migrations

| Migration | Contents                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 030       | Extended the initial wrapper surface: `get_task`, `availableFrom` on the live catalogue, `p_task_id` and lifecycle timestamps on `list_my_task_attempts`, `isActive`/`qualifiedAt` and a bounded referral list on `get_referral_overview`.                  |
| 031       | Profile, notification, support, provider, deposit, withdrawal, token-allowlist, destination and admin-capability wrappers. Notifications and support gained real server-side filters (`p_unread_only`, `p_status`) so filtering happens BEFORE the row cap. |
| 032       | `app_private.submit_deposit_tx` and `public.get_my_deposit`.                                                                                                                                                                                                |
| 033       | `app_private.record_provider_callback`.                                                                                                                                                                                                                     |
| 034       | Provider conversion, attribution, callback-outcome and funding-source commands.                                                                                                                                                                             |

Every wrapper: `security definer`, `set search_path = app, pg_catalog`, revoked
from `public`/`anon`/`authenticated`, granted to `service_role` only. 17 grants
and 17 revokes, balanced.

## Decisions worth arguing about

**Filters run in the database, before the cap, not in TypeScript after it.**
`list_my_notifications(p_unread_only)` and `list_my_support_tickets(p_status)`
filter inside the wrapper. Filtering after a `limit` is a different query that
looks identical: "the 50 newest unread" is not "the 50 newest, of which some are
unread". The same argument moved the admin deposit status filter and the
referral list cap into SQL.

**Some filters stayed in TypeScript, and that is deliberate.**
`list_live_tasks` takes no parameters and neither does `list_providers`. A
caller's `limit` slices what the wrapper returned and cannot raise the wrapper's
own ceiling. Where the ceiling is a safety property rather than a performance
one, it belongs where a caller cannot argue with it.

**Two wrappers return a BOOLEAN instead of a row.** `owns_my_deposit` and
`owns_my_withdrawal` exist so the support-ticket command can validate a linked
record without reading a financial table. Returning the row would have turned a
validation into a read.

**The token allowlist moved its safety filter into the database.**
`list_supported_tokens` returns only rows that are ACTIVE, carry a contract
address and decimals, and have a `verified_at`. Previously that was an
`.eq('is_active', true)` plus a regex in `src/lib/deposits/config.ts`. A safety
property that depends on a filter in application code is one edit away from not
being a safety property. AGENTS.md forbids inventing Celo contract addresses;
this makes that harder to get wrong rather than merely documented.

**The funding-source lookup moved into a function because of law 10.**
`get_active_provider_reward_source` takes the provider code from the URL segment,
never from the payload, and returns only the id, so it can neither be dictated by
a callback nor used to read a budget balance.

**Two behaviours changed, and are worth naming rather than burying.**
The deposit timeline is now derived from the deposit's own timestamps rather than
read from `app.deposit_events`. It is therefore the request's milestones, NOT the
audit log, and it says so in the code. If a screen needs the log, it needs a
wrapper returning the events.

The submit-tx response echoes the status the command returned rather than
hardcoding `SUBMITTED`, because an idempotent replay performs no fresh transition
and claiming otherwise would be a lie in the JSON.

## New quality gate

`tools/check-data-api.mjs` (`npm run check:data-api`), wired into CI.

It harvests the `app` table list from the migrations rather than hardcoding it,
fails loudly if the harvest comes back empty, and ignores comment lines so the
explanations at each converted call site survive. Its own header states the
limit honestly: it is a name check, and a green run says nothing about whether a
wrapper returns a bounded shape or scopes by the session user.

The gate found ten violations on its first run that a hand-written scan had
missed. That is the argument for the automated version.

## Also fixed

- The submit-tx route validated a deposit UUID with the transaction-hash regex,
  rejecting every valid request (Q-14).
- `list_deposits_awaiting_review` widened from eight columns to twenty-one,
  because a wrapper too narrow to review a deposit is how the design gets
  undermined (Q-15).
- `recordCallbackOutcome` is now idempotent; the old insert collided on its own
  primary key and logged an error on every retry.
- The API task list no longer reports a `count` larger than the array it returns.
- The support list distinguishes "could not load" from "no tickets", which the
  previous code rendered identically.

## Not done, and not claimed

- **No SQL in 032, 033 or 034 has been executed.** `check:migrations` validates
  structure, not SQL. The pgTAP suites have still never run.
- No pgTAP assertions were added for the new wrappers. The properties that
  matter (bounded shape, session-user scoping, service_role-only execution) are
  properties of SQL and need a database to assert.
- `get_task` returns any task state, including a retired one. That is intended,
  but it means a task id is a valid probe for "does this task exist".
- Docker is still unavailable, so the 10 existing pgTAP suites remain unexecuted.

## Gate status at time of writing

typecheck, lint, format, 176 unit tests across 11 files, production build, client
bundle secret scan, `check:migrations` (86 functions, 0 errors), `check:data-api`
(70 app tables, 0 violations).
