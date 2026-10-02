# CR-0002 - Phase 0 Foundation, Financial Schema and Command Functions

Document: docs/change-records/CR-0002-foundation-financial-schema.md
Date: 2026-09-30
Class: schema / financial / architecture (doc 81 CHANGE MANAGEMENT)
Authority: doc 71 (Architectural Laws), doc 78, doc 36, doc 37, doc 38, doc 84, ADR-0001 through ADR-0005
Predecessor: CR-0001 (documentation canonicalization) - this change implements its decisions

## Scope

Implements the Phase 0 foundation and the authoritative financial schema that
CR-0001's ADRs describe. It adds migrations, a pure TypeScript mirror of the
monetary rules, and tests. It changes no approved specification and invents no
business rule.

## Migrations

| File                     | Contents                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 foundation           | schemas, domain state enums, capability tables, audit, transactional outbox, RLS lockdown                                                                  |
| 002 capability seed      | canonical capabilities, roles, role-to-capability mapping, legacy alias flag                                                                               |
| 003 ledger tables        | ledger accounts, immutable ledger entries, balance cache, dual-control approval                                                                            |
| 004 ledger functions     | the single append-only writer, balance rebuild, fee calculation, distinct-approver guard                                                                   |
| 005 deposits             | token candidates and active configs, platform destinations, deposit requests, events, verifications                                                        |
| 006 withdrawals          | payout destinations, MiniPay destination verifications, withdrawal requests, payment operations, Cash Link operations, fee records, reconciliation records |
| 007 withdrawal functions | create (reserve), settle, release                                                                                                                          |
| 008 deposit functions    | create, record verification, confirm (credit), reject                                                                                                      |

## Invariants enforced by the database, not by convention

These are the reason the commands exist as `SECURITY DEFINER` functions rather
than as application code:

- `ledger_entries` is append-only, enforced by trigger and by revoked privileges.
  A correction is always a compensating entry, never an update or delete.
- A user-facing balance can never go negative.
- One verified transfer EVENT is creditable at most once. Uniqueness is on
  chain, token contract, transaction hash AND log index, because a single
  transaction can carry several token transfers.
- Token activation requires a verified contract address, decimals and a
  verification timestamp, so a token cannot be activated by accident.
- Native CELO is absent from every deposit asset table.
- Withdrawal gross equals fee plus net exactly, as a table constraint.
- A manual payment operation must name its operator; an automatic one must name
  its provider; and neither can be attached to the other method, so an automatic
  Daimo payout can never silently become a manual one.
- A funding credit is impossible without a prior VERIFIED state, the credit
  amount is the verified on-chain amount rather than the declared one, and the
  requester can never approve their own deposit.
- Only EARNED_REWARD is a withdrawal source. User Funding Balance is a real
  balance and is still not withdrawable.
- No browser-facing role can execute any money-moving function.

## TypeScript mirror

`src/lib/contracts/states.ts` and `src/lib/financial/fee.ts` mirror the database
enums and the fee arithmetic, and `src/lib/financial/withdrawal.ts` mirrors the
eligibility and disclosure rules. These are pure and testable; they compute and
validate, and never move money.

## Tests

- `tests/contracts/states.test.ts` (13 assertions)
- `tests/financial/fee.test.ts` (8 assertions)
- `tests/financial/withdrawal.test.ts` (15 assertions)
- `supabase/tests/withdrawal.sql` (20 pgTAP assertions)
- `supabase/tests/deposits.sql` (10 pgTAP assertions)

## Open verification gates

- The pgTAP suites have NOT been executed. Docker is unavailable on the
  development machine so no local Postgres could be started. They are written and
  statically checked, but unproven. Run `npm run test:db` before trusting this
  schema.
- All four Celo contract addresses are deliberately null and inactive. They must
  be supplied and RPC-verified before any deposit is accepted, and no address may
  be inferred from a ticker symbol.
- The Nigerian legal and accounting review of the user funding balance (doc 84
  section 7) remains a launch gate.
- The Daimo adapter is not implemented. Its capabilities, fees, corridors and
  Nigeria availability must be verified before any automatic payout is enabled.

## Addendum - 2026-09-30, second session: auth, HTTP surface, wallet reads

### What was added

| Area               | Files                                                                             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Auth               | `src/lib/auth/session.ts`, `src/lib/auth/capabilities.ts`                         | verified session, capability guards, fail-closed authorization  |
| Route protection   | `src/proxy.ts`                                                                    | navigation gate for protected pages                             |
| Sign-in / sign-up  | `src/app/(auth)/**`, `src/app/auth/callback/route.ts`                             | identity only; creates no balance                               |
| API plumbing       | `src/lib/api/errors.ts`, `route.ts`, `idempotency.ts`                             | one error shape, correlation IDs, actor-scoped idempotency keys |
| Wallet reads       | `src/lib/wallet/queries.ts`, `summary.ts`, `GET /api/wallet`                      | both balances returned as separate collections                  |
| Deposit surface    | `POST /api/deposits`, `GET /api/deposits/:id`, `POST /api/deposits/:id/submit-tx` | server-provided allowlist, tx submission                        |
| Withdrawal surface | `POST /api/withdrawals`                                                           | gross/fee/net disclosure before confirmation                    |
| Admin surface      | `GET /api/admin/deposits`, `POST .../confirm`, `POST .../reject`                  | capability-gated review and credit                              |

### Why authorization queries explicitly instead of calling app.has_capability()

`app.has_capability()` reads `auth.uid()`. Route handlers run with the service
role, where `auth.uid()` is null, so calling it would return false for EVERY
caller and silently deny every admin action while appearing secure. The guards
pass the already-verified user id explicitly. The identity came from a verified
JWT claim, never from a request body or client state.

### Defect found and fixed during this session

`src/lib/env.ts` and `src/lib/env.server.ts` validated configuration at MODULE
IMPORT time. Adding pages that import them made `next build` fail with the
misleading "Failed to collect page data for /sign-up" whenever deployment
values were absent, because page-data collection runs in a worker whose
environment is not the runtime environment. Both files now validate lazily on
first use. Fail-fast is preserved where it matters; the build no longer depends
on deployment configuration.

`deriveIdempotencyKey` was moved out of `src/lib/api/route.ts` into
`src/lib/api/idempotency.ts`. The `server-only` guard correctly refuses to
import route.ts from a test, and the pure key derivation deserves to be tested
directly rather than left unverified.

### Tests

Added `tests/api/idempotency.test.ts` (8 assertions), covering actor and scope
namespacing so one user can never collide with another user's operation.

Suite: 44 unit tests passing. Typecheck, lint, build and the client-bundle secret
scan all pass. 14 routes registered.

## Addendum - 2026-09-30, third session: Reward Engine (Phase 2 completion)

### Migrations added

| File                 | Contents                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| 009 reward engine    | `reward_sources`, `rewards`, `reward_state_transitions`, `reward_caps` |
| 010 reward functions | `grant_reward`, `transition_reward`, `reverse_reward`                  |

This closes Phase 2. The Reward Engine was previously an enum with no producer;
there was no path at all from a verified earning event to a reward.

### Processing order implemented (doc 35 PROCESSING)

validate funding source -> normalise amount -> apply rule -> check budget and
caps -> apply hold policy -> create immutable ledger entry -> emit event.

### Invariants now enforced

- law 10: a reward cannot exist without a live funding source (foreign key plus
  an active-row check inside the function).
- law 1: the budget is decremented in the SAME transaction as the reward, so a
  reward can never be unbacked and a budget spend can never be lost. The
  constraint `budget_remaining_minor <= budget_total_minor` makes over-allocation
  impossible.
- law 5: `uq_rewards_source_event` on (event_type, source_event_id) means a
  replayed provider callback cannot produce a second reward. This is a database
  guarantee, not adapter memory.
- law 6: a granted reward is PENDING or ON_HOLD, never AVAILABLE. Availability is
  a separate settlement transition.
- law 7: `transition_reward` REFUSES a direct REVERSED or CHARGEBACK transition
  and directs the caller to `reverse_reward`. This is deliberate: without it, a
  reward could be marked reversed with no compensating ledger entry, which would
  be history rewritten without the money moved.
- law 2: a ledger entry exists from the moment the reward exists.
- doc 30 CAPS: a per-user ceiling is evaluated before any write.
- Reward state transitions are append-only via the same immutable trigger as the
  audit log.

### Tests

`supabase/tests/rewards.sql`, 13 pgTAP assertions, including an assertion that
`app.reward_state` matches the doc 35 normative list exactly. This pins the
Q-08 resolution at the database level so a future edit cannot quietly drift back
to the doc 05 narrative vocabulary.

### Gate status

typecheck, lint, 44 unit tests, build, client-bundle secret scan and format check
all pass. The specification corpus is byte-identical.

pgTAP suites total 43 assertions across three files and remain UNEXECUTED:
Docker is unavailable on this machine.

## Addendum - 2026-09-30, fourth session: Notifications and Support (Phases 1 and 9)

### Migrations added

| File                          | Contents                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 011 notifications and support | `notifications`, `support_tickets`, `support_messages`, `support_ticket_events`                                                         |
| 012 commands                  | `create_notification`, `mark_notification_read`, `create_support_ticket`, `post_agent_reply`, `post_user_reply`, `close_support_ticket` |

### The human-only boundary, expressed structurally

A support message is human-authored. A notification is a factual system event.
These are two tables rather than one table with a flag, because:

- `app.author_kind` contains ONLY `USER` and `AGENT`. There is no `SYSTEM` value,
  so no automated process has a value it could insert into the conversational
  record. A missing enum member cannot be set wrongly.
- `notifications` has no author column at all, so a notification cannot be
  mistaken for a reply.

The agent reply endpoint additionally: requires `support.reply` re-checked
server-side, takes its actor identity from the verified JWT rather than the
request body, and has no "generate a reply" field anywhere.

### Other invariants

- law 59: creating a ticket moves no money and grants no exception. Linked
  deposit/withdrawal references are ownership-checked before being stored, and are
  stored as links rather than copied evidence.
- law 61: no paid notification provider is referenced anywhere.
- Notifications are idempotent on a key derived from the SOURCE EVENT, so two
  workers converge on one record rather than a duplicate stream.
- `notifications_action_path_relative` blocks an absolute off-site link.
- Agent replies are audit logged by trigger, so a reply cannot be written
  unrecorded. Ticket events are append-only.

### Routes added

`GET /api/notifications`, `POST /api/notifications/:id/read`,
`GET|POST /api/support/tickets`, `POST /api/admin/support/tickets/:id/reply`.

### New quality gate

`tools/check-migrations.mjs` (`npm run check:migrations`), wired into CI. It pairs
each `create or replace function` with the NEXT `$$;` line and fails on an
unclosed function, an orphan close, a duplicate tail, a leftover edit marker, or
unbalanced `if`/`end if`. Its existence is a direct response to Q-11.

### Gate status

typecheck, lint, 51 unit tests, build, client-bundle secret scan, format check and
migration structure check all pass. 17 routes. 26 SQL functions across 12
migrations. The specification corpus is byte-identical.

pgTAP suites total 60 assertions across four files and remain UNEXECUTED: Docker
is unavailable on this machine.

## Addendum - 2026-09-30, fifth session: Phase 0 observability and Phase 1 shell

### Phase 0 closed: the outbox now has a consumer

Migration 001 created `app.outbox_events` and every financial command writes to it,
but NOTHING consumed those rows. Events were recorded and never acted on, so
notifications were never produced and the transactional outbox described in
ADR-0001 was only half implemented.

Added:

| File                                | Contents                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| migration 013                       | `claim_outbox_events`, `complete_outbox_event`, `fail_outbox_event`, `outbox_backlog` |
| `src/lib/observability/logger.ts`   | structured JSON logging, redaction, business metrics                                  |
| `src/lib/observability/payload.ts`  | pure, testable outbox payload readers                                                 |
| `src/lib/observability/handlers.ts` | one handler per event type, notifications only                                        |
| `src/lib/observability/outbox.ts`   | batch drain with claim, completion and bounded retry                                  |
| `/api/internal/outbox/drain`        | worker endpoint, shared-secret protected                                              |

Design points:

- The claim uses `FOR UPDATE SKIP LOCKED`, so several workers may drain
  concurrently and no event is delivered twice.
- A lease moves `available_at` forward, so a worker that dies mid-event leaves the
  row recoverable instead of stuck in PROCESSING.
- Retries are bounded and back off exponentially to a 10 minute cap, then become
  DEAD and visible. They never retry forever.
- Handlers produce NOTIFICATIONS only. No handler mutates a balance, approves a
  deposit or settles a payout. A handler failure never rolls back the ledger
  entry that produced the event, because the money already moved.
- The worker endpoint compares its shared secret with a constant-time comparison
  and FAILS CLOSED when the secret is unset, so an unconfigured deployment is
  closed rather than open.

### Phase 1: application shell

Added the `(app)` route group with a server-rendered shell: navigation, a live
unread notification badge, and sign-out. The wallet, notifications and support
pages now live inside it.

The notifications page states explicitly that these are factual system events and
not support replies, so a status message is never mistaken for a human response
(law 60).

### Defect found by test in this session

`BigInt('')` returns `0n` and does not throw, so an outbox event whose payload
lacked an amount would have been read as a genuine zero and the user would have
been shown `0 NGN` as a real figure. Fixed and covered by four tests. See Q-12.

### Gate status

typecheck, lint, 69 unit tests, build, client-bundle secret scan, format check and
migration structure check all pass. 21 routes. 30 SQL functions across 13
migrations. The specification corpus is byte-identical.

pgTAP suites remain UNEXECUTED: Docker is unavailable on this machine.

## Addendum - 2026-09-30, sixth session: Phase 3 provider ecosystem

### Migrations added

| File                       | Contents                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 014 providers              | `providers`, `provider_capabilities`, `provider_callbacks`, `provider_callback_results`, `provider_conversions`, `provider_settlements`, `offers`, `surveys`, `provider_participations`, 5 enums, 14 candidate seeds |
| 015 provider reward bridge | `apply_conversion_reward`, `reverse_conversion`                                                                                                                                                                      |

### Scope decision: framework, not a live vendor

NO live provider integration was written. Doc 07 requires integration tests,
callback authenticity validation, duplicate/replay tests, economic validation and
business/compliance approval before a provider may be live, and none has been
performed for any vendor. Doc 78 forbids inventing provider behaviour. All 14
doc 06 vendors seed as CANDIDATE with every gate timestamp null.

### Doc 07 decision gates are a database invariant

`providers_live_requires_all_gates` requires all six of integration_tested_at,
callback_authenticity_tested_at, duplicate_replay_tested_at, economic_validated_at,
commercial_approved_at and compliance_approved_at, plus last_verified_at, before
lifecycle_state may be LIVE. A single UPDATE that forgets one of them fails. This
turns an operational checklist into something the database enforces, and it is
why a seeded vendor cannot be casually activated.

`providers_live_requires_expiry` makes staleness representable, honouring doc 07
DYNAMIC NATURE.

### Callback ingestion covers all seven doc 08 requirements

`POST /api/providers/callbacks/[provider]` sequences them and records raw evidence
BEFORE acting on any verdict, so a rejected callback is still auditable:

1. authenticate origin - the provider row must resolve
2. validate signature - adapter.verifyCallback, fails closed to UNSUPPORTED
   when no secret is configured
3. validate required fields - adapter.handleCallback returns null rather than
   guessing
4. validate identifiers - the USER is resolved from OUR tracking table using an
   id WE minted, so a forged callback cannot credit an account it names
5. timestamp and replay window - future skew beyond 5 minutes is refused so a
   leaked key cannot hold a replay window open
6. idempotency - uq_provider_conversions_event on (provider, provider_event_id)
7. record raw evidence - append-only, with the outcome in a separate table

The response is deliberately uniform: a provider must not learn whether a
callback was unknown, forged or duplicate, because that difference tells an
attacker which stage to attack.

### Financial boundary

A callback never writes the wallet. It produces a validated conversion, and
`apply_conversion_reward` is the only path from a provider event to money. It
refuses unless the conversion is VALIDATED, resolves to a user, belongs to a LIVE
provider, and names a funding source. It then calls `grant_reward`, never
`post_ledger_entry`. A SUSPENDED provider's postback is recorded and marked
ineligible, never paid. `reverse_conversion` routes through `reverse_reward`, so a
reversal is a compensating event and the original reward keeps its history.

### Defect found by test in this session

The provider amount parser accepted "10.00" as 1000 minor units but rejected
"0.50". That was incoherent: "0.50" is exactly 50 minor units and entirely
representable. The underlying mistake was treating a decimal point as
sub-minor precision rather than as a MAJOR-unit amount whose scale is unknown.
Reading "10.00" as 10 minor units instead of 1000 is a hundredfold payout error in
either direction, so any decimal is now refused with a reason that names the fix.
The tests assert the corrected rule.

### Gate status

typecheck, lint, 101 unit tests, build, client-bundle secret scan, format check and
migration structure check all pass. 22 routes. 32 SQL functions across 15
migrations. The specification corpus is byte-identical.

pgTAP suites total 78 assertions across five files and remain UNEXECUTED: Docker
is unavailable on this machine.
