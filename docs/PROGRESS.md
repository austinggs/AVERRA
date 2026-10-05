# AVERRA - PROGRESS NOTES

Artifact: progress notes per `80_PROGRESS_TEMPLATE.md`
Status: living document
Companion artifacts: `docs/change-records/` (what changed and why), `docs/DISCREPANCIES.md` (spec vs implementation)

## Why this file exists

`00_START_HERE.txt` instructs every agent to "update progress notes", and doc 80
defines the template and the status vocabulary below. The project had 15 change
records and no progress ledger at all, so "where are we?" could only be answered by
reading 15 documents. A change record answers _what changed and why_; a progress
note answers _what state are we in_. They are not substitutes.

## Status vocabulary

PLANNED, IN_PROGRESS, BLOCKED, READY_FOR_REVIEW, COMPLETE, VERIFIED, DEFERRED.

Progress notes are evidence of implementation state. They do not override approved
specs (doc 80 RULE).

## Conformance snapshot

Against `76_IMPLEMENTATION_PHASES.md` and `77_MILESTONES.md`. "Built" means
migrations and/or source exist AND, where a database invariant is claimed, a pgTAP
assertion covers it. This snapshot is the answer to "is everything in
AVERRA_FULL_PLAN implemented?": no, and here is precisely where the line falls.

| Area                                                              | Phase / Milestone | State                                                                                  |
| ----------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Repository, CI/CD, observability, contracts, source-of-truth docs | 0 / M1            | COMPLETE                                                                               |
| Identity, profiles, sessions, navigation                          | 1 / M1            | COMPLETE                                                                               |
| Reward Engine, ledger, financial invariants, audit                | 2 / M2            | VERIFIED                                                                               |
| Provider adapters, offers, surveys, callbacks, reconciliation     | 3 / M3            | COMPLETE (no live provider onboarded)                                                  |
| Native tasks, verification, budgets                               | 4 / M4            | VERIFIED                                                                               |
| Mining Game server state, machines, energy, inventory             | 5 / M5            | COMPLETE (server side only)                                                            |
| Mining Game Three.js shell, asset pipeline, world                 | 5 / M5            | Rendering layer COMPLETE (CR-0020); assets/LOD/audio absent                            |
| Game expansion: missions, events, achievements, leaderboards      | 6 / M5            | COMPLETE                                                                               |
| Withdrawals, payout destinations, 15% fee, manual payouts         | 7 / M6            | COMPLETE                                                                               |
| User Funding deposits, MiniPay manual, token tiers                | 7 / M6            | COMPLETE                                                                               |
| Daimo deposit/Hurry and automatic payout                          | 7 / M6            | PLANNED (adapter seams only; doc 30 requires provider verification first)              |
| Cash Link operations                                              | 7 / M6            | Data model COMPLETE; provider integration PLANNED                                      |
| Referrals, gamification, advertiser platform                      | 8                 | COMPLETE                                                                               |
| Fraud/risk, moderation, support, notifications                    | 9                 | VERIFIED                                                                               |
| Reviews & Community (docs 86, 76 addition, 77 addition)           | 9 / M7            | Data + authority + API + UI COMPLETE (CR-0016, CR-0021); console absent                |
| Admin Portal UI (doc 87, 20 modules)                              | 9                 | **ABSENT** (RBAC/dual-approval data model COMPLETE)                                    |
| Paid perks, donations, funding spend (doc 83, 75)                 | 8                 | Data + funding-spend commands COMPLETE (CR-0017); API + UI + recurring billing PLANNED |
| Production hardening: security testing, DR, load, runbooks        | 10 / M7           | PLANNED                                                                                |

### Cross-cutting gaps, stated plainly

1. **Nothing is deployed.** No Vercel project, no Supabase Storage policies, no
   scheduled jobs. Docs 60/61/62/63 are unstarted.
2. **No live provider is onboarded.** Doc 07's decision gates are unexercised. As of
   2026-10-04 a real CPX callback **is** authenticated end to end (CR-0031), but
   `cpx_research` is `CANDIDATE` with all seven gate timestamps null, no reward source
   exists, and no conversion has been recorded - so the gates remain unexercised.
3. **The admin portal is data-only.** The capability model, roles, dual-approval
   and audit trail exist in SQL; there is no console to use them (doc 87 lists 20
   modules; none is built).
4. **The four Celo token addresses remain null and inactive**, by design, pending
   RPC verification (doc 82 CURRENT PROVIDER VERIFICATION NOTE). USDm and USAT must
   stay inactive until individually verified.

---

## Session - 2026-10-02 - Reviews & Community database layer (CR-0016)

Date: 2026-10-02
Agent/owner: AI coding agent (session with the repository owner)
Phase: 9 - Operations (REVIEWS & COMMUNITY ADDITION)
Milestone: M7 (Reviews/Community addition) - data and authority layer only
Status: COMPLETE for the database layer; API and UI PLANNED
Task: Audit the specification corpus against the implementation, then build the
largest fully-specified subsystem that has no financial authority.

Relevant source docs: `86_REVIEWS_COMMUNITY_SYSTEM.md`,
`48_DATABASE_SCHEMA.txt` (REVIEWS / COMMUNITY TABLES), `58_CONTENT_MODERATION.txt`,
`65_TESTING_STRATEGY.md`, `67_SECURITY_TESTING.md`, `10_UI_UX_SPECIFICATION.txt`
(REVIEWS & COMMUNITY UI), `71_ARCHITECTURAL_LAWS.md` laws 62-70,
`76_IMPLEMENTATION_PHASES.md`, `77_MILESTONES.md`, `50_BACKEND_ARCHITECTURE.txt`.

Existing implementation inspected: all 37 migrations (enumerated every `app.*`
table and every enum), `src/lib/auth/capabilities.ts`,
`src/lib/env.server.ts`, `src/components/game/GameShell.tsx`, `package.json`
dependencies, every route under `src/app/api/`, `.github/workflows/ci.yml`,
`supabase/tests/*.sql`.

Changes made:

- `supabase/migrations/20260930000038_reviews_foundation.sql` (new) - seven enums,
  the six tables of doc 86, constraints, indexes, RLS, grants.
- `supabase/migrations/20260930000039_review_functions.sql` (new) - seven
  `app_private` commands, one revocation-aware capability guard, six `public`
  entry points, five `public` read wrappers. 20 functions.
- `supabase/tests/reviews.sql` (new) - 37 assertions.
- `.prettierignore` - added `.kilo` (Q-32).
- `docs/DISCREPANCIES.md` - Q-31, Q-32.
- `docs/change-records/CR-0016-reviews-community-system.md` (new).
- `docs/PROGRESS.md` (new) - this file.
- Removed a stray agent git worktree under `.kilo/worktrees/` (Q-32).

Tests added/run: `supabase/tests/reviews.sql`, 37 assertions, all passing. Full
suite 11 files / 213 assertions / 0 failures. Defect injection: dropping
`reviews_verification_evidence_consistent` failed exactly assertion 18 by name and
number; restored byte-identically and the suite returned to 37/37.

Typecheck: clean (`tsc --noEmit`).
Lint: clean (`eslint .`).
Build: `Compiled successfully`.
Format: `prettier --check .` clean.

Security/financial considerations:

- Law 63 (reviews never mutate financial state) is enforced by the ABSENCE of any
  financial column and any foreign key to a financial table, asserted two ways.
- Law 64 (Verified Experience is verified activity, not endorsement) is enforced at
  write time: the referenced qualifying event must exist AND belong to the author,
  or the write is refused rather than downgraded. The reference is opaque text, so
  the public read surface cannot resolve it.
- Law 65 (no payment for positive reviews) cannot be violated without a schema
  change: there is no reward or budget reference anywhere in the subsystem.
- Law 67 (human moderation) is enforced by an append-only moderation log and by a
  capability check; law 69 by a public projection that withholds private evidence.
- `USER_FUNDING_SPEND` was found to be declared but unused; doc 83/75 remain
  unbuilt. No money path was touched by this change.

Open verification gates:

- Doc 86 API routes and UI do not exist; the database layer is the contract for
  them.
- Supabase Storage bucket policies for review media are not created.
- Q-31: `app.has_capability()` does not honour `revoked_at`. Not fixed here; it
  belongs in its own change record.
- No live provider, no deployment, no admin console (see Cross-cutting gaps).

Acceptance criteria satisfied (doc 86 ACCEPTANCE CRITERIA and doc 70 REVIEWS &
COMMUNITY ACCEPTANCE): 1, 2 (metadata layer), 3, 4, 6, 7 (authority layer), 8, 9,
10, 11, 12, 14, 16, 17. Partially satisfied: 5 (reply media metadata modelled; no
upload endpoint), 15 (Storage policy outstanding). Not yet applicable: 18 (in-app
notifications for replies - no notification is emitted by this layer).

Files changed: listed in `docs/change-records/CR-0016-reviews-community-system.md`.

Next atomic task: **doc 83 - paid perks, donations and the user-funding spend
path**, because `USER_FUNDING_SPEND` already exists in the ledger vocabulary and the
game economy (doc 75) has no way to spend a confirmed funding balance without it.
Unlike the reviews layer this one touches money, so it needs the full treatment:
funding-spend command, entitlement tables, budget caps, and pgTAP coverage. The
alternative next task is the Three.js shell (doc 17, M5), which is greenfield
client work with no financial risk.

---

## Session - 2026-10-03 - Paid perks, donations and the funding-spend path (CR-0017)

Date: 2026-10-03
Agent/owner: AI coding agent (session with the repository owner)
Phase: 8 - Growth (paid perks / donations, doc 83, with the doc 75 game bridge
modelled but intentionally empty)
Status: COMPLETE for the database and command layer; API and UI PLANNED
Task: Build the second of the three subsystems CR-0016 named as absent - the one
that moves money - so `USER_FUNDING_SPEND` stops being an enum member naming a
path the schema did not implement.

Changes made:

- `supabase/migrations/20260930000040_paid_perks_foundation.sql` (new) - four
  enums, five tables (`paid_perk_products`, `paid_perk_orders`,
  `paid_entitlements`, `donations`, `funding_spend_events`), RLS, no grants to
  `anon`/`authenticated`.
- `supabase/migrations/20260930000041_funding_spend_commands.sql` (new) - four
  `app_private` commands, three `public` entry points, three `public` read
  wrappers. 10 functions.
- `supabase/tests/perks.sql` (new) - 35 assertions.
- `docs/DISCREPANCIES.md` - Q-33, Q-34, Q-35 (three defects found while building,
  all fixed and their gates proven by re-injection).
- `docs/change-records/CR-0017-paid-perks-funding-spend.md` (new).

Tests added/run: `supabase/tests/perks.sql`, 35 assertions. Full suite 12 files /
248 assertions / 0 failures against the live database (was 213 across 11). Two
injected defects (an `anon` grant on `list_perk_products`; a donation-keyed
ledger row) each failed exactly the assertion written for them, by name and
number, and were restored.

Gates: `check:migrations` 143 functions / 0 errors; `check:grants` 75 public
functions / 0 errors; `check:data-api` 81 app tables / no direct access;
`npm test` 176 vitest tests passing.

Financial invariants enforced (see CR-0017 for how each is asserted):

- A purchase can never become an earned reward; the only money writer posts a
  `USER_FUNDING_SPEND` DEBIT against the `USER_FUNDING` account.
- A donation is acknowledgement, never a balance; `record_donation` cannot reach
  a money primitive.
- Refunds are compensating entries; the original debit is untouched.
- A duplicate purchase is refused before any write.

Open verification gates:

- Doc 83 API SURFACE routes and doc 10 paid-perks UI do not exist; the database
  layer is the contract for them (catalogue read, purchase, donation, refund,
  entitlement/spend history).
- No recurring billing: `billing_period`/`duration_seconds` are modelled but
  nothing renews a subscription. Renewal is a money path and needs its own
  command and change record.
- Admin refund approval is not modelled (doc 83 does not state it; not invented).
- `GAME_PURCHASE` is wired but empty, and `review_experience_type` still lacks
  that value, until the Mining Game economy exists.
- The Three.js shell (doc 17, M5) is still absent.

Files changed: listed in `docs/change-records/CR-0017-paid-perks-funding-spend.md`.

Next atomic task: **doc 86 - Reviews & Community API routes and UI**, the oldest
open gate (CR-0016): the database layer is complete and tested, and the API/UI
work carries no financial authority. The alternatives are the doc 83 paid-perks
API surface (touches the funding-spend commands, so it needs the money-path
treatment) and the Three.js shell (greenfield client work, no financial risk).

---

## Session - 2026-10-03 - Reviews & Community API and UI, then the Mining Game Three.js layer

Date: 2026-10-03
Agent/owner: AI coding agent (session with the repository owner)
Phase: 9 - Operations (reviews addition), then 5 - Mining Game
Milestone: M7 (reviews addition), M5 (game client)
Status: Reviews API/UI COMPLETE for the non-media surface; game rendering layer
COMPLETE; both partially verified
Task: Close the two oldest unblocked application-layer gaps. Neither touches
financial authority, which is why both were safe to do before the Admin Portal.

Relevant source docs: `86_REVIEWS_COMMUNITY_SYSTEM.md` (API SURFACE, IMAGE
SUPPORT, NOTIFICATIONS), `83_MONETIZATION_PAID_PERKS.md`, `10_UI_UX_SPECIFICATION.txt`
(REVIEWS & COMMUNITY UI), `17_MINING_GAME_THREEJS_ARCHITECTURE.txt`,
`31_MINING_GAME_SERVER_AUTHORITY.txt`, `16_MINING_GAME_GAMEPLAY.txt`,
`71_ARCHITECTURAL_LAWS.md` (laws 63-69, 26), `65_TESTING_STRATEGY.md`.

Existing implementation inspected: migration 038/039 (review schema and 20
functions), 040/041 (paid perks), 030 (`public.get_game_state`), the `app_private`
capability guard, `src/lib/api/route.ts`, `src/components/game/GameShell.tsx`,
every route under `src/app/api/`.

Changes made:

Reviews (no migration):

- `src/app/api/reviews/route.ts` - `GET` public, `POST` submit.
- `src/app/api/reviews/mine/route.ts`, `src/app/api/reviews/reports/route.ts`.
- `src/app/api/reviews/[reviewId]/comments/route.ts` - `GET` public, `POST` reply.
- `src/app/api/admin/reviews/route.ts` - moderation queues, `review.moderate`.
- `src/app/api/admin/reviews/moderate/route.ts` - human decision, append-only.
- `src/app/api/admin/reviews/reports/[reportId]/resolve/route.ts`.
- `src/lib/reviews/contract.ts`, `src/lib/reviews/queries.ts`.
- `src/app/(app)/reviews/page.tsx`, `src/app/(app)/reviews/mine/page.tsx`,
  `src/components/reviews/ReviewCard.tsx`, `src/components/reviews/ReviewForm.tsx`,
  `src/components/ui/StarRating.tsx`.
- `tests/reviews/contract.test.ts` - 24 assertions.

Mining Game (no migration, no new API):

- `src/lib/game/scene.ts` - pure scene model.
- `src/components/game/GameScene.tsx` - the Three.js renderer.
- `src/components/game/GameScenePanel.tsx` - lazy-loaded, WebGL-guarded panel.
- `tests/game/scene.test.ts` - 39 assertions.
- `src/app/(app)/game/page.tsx` - panel added above the shell; `GameShell` unmodified.

Tests added/run: 200 -> **239 passing across 13 files**. Reviews 24 assertions,
game 39. Build, typecheck, lint, `check:bundle` and prettier all clean. Three.js is
confirmed isolated in a 529 KB lazy chunk rather than the initial load.

Defect injection: removing the energy clamp in `interpolatedEnergy` failed exactly
two named assertions, and the suite was restored. Recorded in CR-0020 alongside two
bad test assertions that were found and corrected rather than worked around.

Security/financial considerations:

- Nothing in either subsystem can move money. A purchase never becomes an earned
  reward (law 47) and a review carries no financial column at all (law 63).
- `review.moderate` is checked twice on purpose: once for a clean 403 in the route,
  and again inside the SQL wrapper, so a revoked operator fails even if the route
  were bypassed. `p_moderator_id` always comes from the verified session, never
  from the request body or the query string.
- The Verified Experience badge is deliberately NOT offered in the client form. A
  client-supplied `verifiedExperienceId` would be a self-asserted claim, which is
  what law 64 forbids; the server must look up the author's real activity.
- The 3D layer writes no state, and a tampered client clock cannot fill the energy
  gauge (doc 17 SECURITY).

Open verification gates:

- **No live database run.** `npm run test:db` needs `SUPABASE_DB_URL` in the
  process environment, and the pooler form is not derivable from the files on disk.
  Nothing built this session has been executed against Postgres.
- **No visual verification of the 3D scene.** There is no `tests/e2e` and no
  Playwright browser cache, so the canvas has never been drawn. It needs one manual
  pass at `npm run dev` on `/game`.
- Doc 86 endpoints still missing because **no database command exists for them**:
  `PATCH`/`DELETE` on reviews and comments, and comment media (the
  `review_comment_media` table exists with no writer). Migration 039 also writes no
  outbox events, so reply notifications have no source yet.
- Supabase Storage policies and media upload are not built. Media renders as a
  text placeholder; a `storagePath` is never resolved into a guessed public URL.
- Doc 83 has **no API section at all**, so the paid-perks endpoint set would be
  invented rather than implemented. CR-0017's own reference to a "Doc 83 API
  SURFACE" does not exist in the document.
- `paid_perk_orders` is **never inserted** by any migration, so `PERK_PURCHASE`
  always raises `unknown order`. The purchase path is dead until a
  `create_paid_perk_order` command exists. The donation path is complete.
- Game assets, LOD, instancing, texture budgets and audio are absent (doc 17).
- No `src/app/admin` pages exist; the admin surface is API-only.

Acceptance criteria satisfied: the doc 86 application-layer criteria that do not
require Storage or an author-editing command. Doc 17 is a planning baseline with no
numbered criteria. Neither subsystem is claimed to meet criteria it has not been
tested against.

Files changed: listed in `docs/change-records/CR-0020-mining-game-threejs-layer.md`.

Next atomic task: **migration 042** - the review authoring commands (update/soft-
delete reviews and comments), `attach_review_comment_media`, the reply outbox event,
and Supabase Storage policies. These are the missing half of doc 86 and every one
of them is a database-authority gap rather than a UI preference.

---

## Session - 2026-10-03 - Review authoring commands and reply notifications (CR-0021)

Date: 2026-10-03
Agent/owner: AI coding agent (session with the repository owner)
Phase: 9 - Operations (REVIEWS / COMMUNITY ADDITION)
Milestone: M7 (Reviews/Community addition)
Status: COMPLETE and **VERIFIED LIVE**: 13 suites / 274 assertions / 0 failures
Task: Fill the five doc 86 endpoints that had no database command behind them, and
give `review_comment_media` the writer it never had.

Relevant source docs: `86_REVIEWS_COMMUNITY_SYSTEM.md` (API SURFACE lines 198-216,
IMAGE SUPPORT, NOTIFICATIONS line 220, PRIVACY), `71_ARCHITECTURAL_LAWS.md` laws
63-69, `80_PROGRESS_TEMPLATE.md`.

Existing implementation inspected: migration 038 (six tables and their
constraints), 039 (20 functions), 001 (`app.outbox_events` and its dedup index),
011 (`app.notifications`), `src/lib/api/route.ts`, `src/lib/observability/handlers.ts`.

Changes made:

- `supabase/migrations/20260930000042_review_authoring.sql` (new) - 11 functions:
  `update_review`, `delete_review`, `update_review_comment`,
  `delete_review_comment`, `attach_review_comment_media`, an outbox trigger, and
  five `public` entry points in the migration-035 pattern.
- `supabase/tests/review_authoring.sql` (new) - 26 assertions.
- `src/app/api/reviews/[reviewId]/route.ts` (new) - PATCH, DELETE.
- `src/app/api/reviews/comments/[commentId]/route.ts` (new) - PATCH, DELETE.
- `src/lib/observability/handlers.ts` - the `review.comment.added` handler.

Tests added/run: **26 pgTAP assertions, all executed against the live database.** Full
suite 13 files / 274 assertions / 0 failures (was 248 across 12). This is the first
time the pgTAP suites have ever run against a live project; `npm run test:db:pooled`
now exists to keep them running. Structural gates: `check:migrations` 154 functions /
0 errors (was 143), `check:grants` 80 public functions / 0 errors (was 75). `typecheck`,
`lint`, `test` (239), `build` and `prettier --check .` all clean.

Defect injection: an orphan `$$;` was injected into 042 and `check:migrations`
failed with both the orphan and the odd-delimiter error, naming line 434. Restored
byte-identically.

Security/financial considerations:

- Every command scopes its lookup by BOTH the session user id and the record id, so
  another author's row is reported as **unknown** rather than **forbidden** -
  reporting "forbidden" would confirm that an id exists (doc 67 BOLA).
- Deletion is SOFT. The row survives, because doc 09 requires the author to see
  what happened to their content and doc 67 requires the moderation trail to
  outlive a takedown. Asserted: a deleted review still exists.
- A PUBLISHED review cannot be edited in place. Rewriting text others have already
  read and replied to is a history rewrite wearing a UI.
- The reply notification carries **no comment text**. The comment is still PENDING
  when the trigger fires, so its content is unmoderated and must not escape through
  a notification (doc 86 PRIVACY). Asserted: `payload ? 'body'` is false.
- Law 63 asserted by absence: no authoring command's `prosrc` names a money
  primitive.
- `notification_category` gained `COMMUNITY`, so a user filtering alerts can
  separate "someone replied to you" from generic platform notices.

Open verification gates:

- Supabase Storage policies and the media upload route are still not built.
  `attach_review_comment_media` records metadata for an object nothing uploads.
- The review moderation console UI is not built. There is still no `src/app/admin`
  directory at all; the admin surface is API-only.

Acceptance criteria satisfied: the doc 86 API SURFACE endpoints that depend on an
authoring command are now backed by a command. Media upload and the console remain
outstanding, and no criterion is claimed for anything untested.

Files changed: listed in
`docs/change-records/CR-0021-review-authoring-and-reply-notifications.md`.

Next atomic task: **`create_paid_perk_order`**. Migration 041's
`purchase_with_funding` requires a pre-existing `app.paid_perk_orders` row, and no
migration ever inserts one, so `PERK_PURCHASE` always raises `unknown order`. The
entire paid-perks purchase path is dead until that command exists, which makes it
the next database-authority gap rather than a UI preference.

---

## CR-0026 - Referral reward funding and payment policy

Complete. Migration `20260930000052_referral_reward_funding.sql`.

Decision: the **software** decision and the **money** decision are separated. The
code states "a referral is worth N500"; it does not state "therefore go spend
N500,000". Funding is an explicit operator action against an explicit amount.

The `AVERRA_PROMOTIONAL` source ships **inactive with a zero budget**. Nothing in this
CR applied funds, so no financial liability exists by accident.

---

## CR-0027 - Referral payout orchestration, read model, admin monitoring

Complete. Migrations 053, 054, 055.

The referral programme now has a driver. Before this CR, `pay_referral_reward`
existed, was proven, and had **no caller** - the same shape of defect as
`paid_perk_orders` (Q-38).

**Orchestration.** A trigger fires on the transition into `QUALIFIED` and writes a
`referral.payout_due` outbox event in the same transaction. It does **not** pay.
Calling the payout inside the qualifying transaction would roll back a legitimate
qualification whenever the payment failed, which loses the user money and leaves no
retry, no visibility and no dead letter. The payment runs later in the worker, where
failures retry with backoff and permanent failures land in `last_error`.

Three independent guards stop a retry paying twice: the outbox dedup index, the
`REWARDED` early return, and the `referral-reward:<id>` idempotency key. The trigger
fires only on the _transition_ into `QUALIFIED`, so the recurring
`qualified_value_minor` updates cannot re-trigger it - asserted directly.

The handler separates two POLICY outcomes (cap reached, programme unfunded), which
are logged and dropped because retrying cannot change them, from everything else,
which throws. Both are logged, because a silently dropped event is what the outbox
exists to prevent.

**Visibility.** `public.get_referral_programme_stats` reports attributed, qualified,
rewarded, **unpaid qualified**, **cap-hit**, budget remaining, and pending/failed
payout events. `capHit` is the number that says whether the 100-referral cap is now
protecting the programme or costing it.

**Funding control.** `public.admin_fund_referral_programme` is capability-gated
**in SQL**, not in the route, because a route can be bypassed and a function cannot.
The amount is always explicit; there is no default.

**Read model.** `get_referral_overview` now returns progress toward the threshold and
a reward history. A user who has referred somebody can see the system working.

**Two defects caught in the presentation layer:**

- `app.reward_state` has **no `SETTLED`** value; the credited state is `AVAILABLE`. A
  draft compared `reward.state === 'SETTLED'` against the database enum, which is
  always false, so genuinely available money would have rendered neutral grey.
  `mapRewardState` owns the mapping now, is unit tested against every enum value, and
  fails closed on an unknown state.
- The first draft rescaled amounts to naira. This project renders **raw minor units
  with the unit**, so a referral would have been the only amount on the product
  formatted differently.

**Q-39.** Migration 054 was pushed, then edited to add a field. `db push` never
re-ran it: Supabase records a migration by version and never compares file contents,
so the file described a function the database did not have and the push still printed
success. Typecheck, lint, `check:migrations`, `check:grants` and all 409 assertions
passed, because none of them compare the file to the database. It was caught by
querying `pg_proc.prosrc` directly. Migration 055 supersedes it. The rule is now in
AGENTS.md: **an applied migration is frozen; correct it with a new one.**

**Verification:** 19/19 pgTAP suites, **409 assertions**, 0 failures. 245 Vitest
tests. `check:migrations` 189 functions, `check:grants` 91 public functions,
`check:data-api` 83 tables, `check:bundle` clean. Typecheck, lint, build and
`prettier --check` clean. Deployed state confirmed by query: `unit` present; all three
new or changed functions closed to `anon`.

**Still open:** the programme is unfunded. `50,000,000` kobo awaits explicit
operator confirmation. `claim_due_referral_payouts` is operator-triggered because no
scheduler exists yet (docs 60/61/62 unstarted). `paid_perk_products` is still empty,
so no perk can be bought and no product has been invented. (The funding was approved
and applied in CR-0028, below.)

---

## CR-0028 - Fund the referral programme at 50,000,000 kobo

- **Status:** Complete
- **Date:** 2026-10-04
- **Authority:** the owner's explicit confirmation of this amount.
- **Closes:** the money half of CR-0026, which deliberately shipped unfunded.
- **Authorities:** 39_REFERRAL_SYSTEM.txt, law 10 (traceable funding), law 27
  (attributability), law 56 (funding separate from user funding).

## The decision

    50,000,000 kobo  (NGN-kobo)  =  N500,000
    reward per referral          =      500 kobo
    -> 1,000 payouts, exactly

The division is exact. `pay_referral_reward` draws the **full** configured reward or
refuses; it never pays part of one. An inexact budget would leave the final payout
failing rather than paying a fraction, with a user whose referral genuinely qualified
left unpaid. 50,000,000 is asserted by pgTAP to divide evenly, so that cannot happen
silently.

Migration 056 applies it. `budget_total_minor = 50000000`,
`budget_remaining_minor = 50000000`, `is_active = true`, one `audit_events` row.

## The migration is GUARDED, because the funding function is ADDITIVE

`fund_promotional_reward_source` does `budget_total_minor + p_budget_minor`. It refuses
only zero or negative. Calling it twice with this amount produces a **100,000,000**
budget - double the approved liability - with no error and no warning.

A plain `select app_private.fund_promotional_reward_source(50000000, null);` would be
therefore correct exactly once and dangerous every time after: a fresh database
applies it properly, and any replay or manual re-run silently doubles the programme.

Migration 056 instead:

- funds only when the source is **unfunded**, and
- tops up only by the **shortfall**, so a smaller existing budget lands on the
  approved figure rather than exceeding it, and
- `raise notice`s what it skipped.

Re-running the exact block against the live database was verified: the budget stayed at
50,000,000 and the audit count stayed at 1.

**No actor id is recorded.** A migration is not performed by a signed-in user, and
attributing it to one would put a false identity in `audit_events` (law 27). The
decision is attributable through the migration version and the commit, which is a
stronger record than a user id.

**Top-ups are not done by editing the constant.** The version is already applied, so
that would silently do nothing - Q-39 from the other direction. Later funding goes
through `public.admin_fund_referral_programme`, which is capability-gated and records
the actor.

## Q-40 - `check:migrations` failed valid SQL

Migration 056 opens with `do $$ ... $$;`, an anonymous PL/pgSQL block. PostgreSQL
accepted it; the gate rejected it as `orphan $$; with no open function`. The gate
paired every `$$;` with a function declaration and had no model for a block.

The obvious repair - ignore a `$$;` when nothing is open - would have deleted the
orphan check that catches the truncated-function defect the tool exists for (Q-11),
turning a false positive into a false negative. Instead a `do $$` now opens a tracked
block of its own kind, pairs with its `$$;`, and carries the same `if`/`end if`
balance check.

Verified with **twelve injected cases**, each written to a real migration file, run,
and restored byte-identically: valid DO blocks pass, and a genuine orphan, an unclosed
function, a missing `end if;` inside a block, an unclosed block, and a function
unclosed before a DO block all still fail.

## Two tests were coupled to a production data value

Funding broke 9 assertions across two suites. Neither was a defect in the payout path.

`referral_reward.sql` asserted `budget = 0` and `is_active = false` directly from the
deployed source. That was true while the programme was unfunded by design, and became
false the moment it was funded. The invariant actually worth testing is not "the
deployment is unfunded" but:

    an unfunded programme REFUSES to pay, and creates no reward  (law 10)

so the suite now establishes that precondition explicitly, inside its own transaction,
and is independent of the deployed funding decision. A new assertion confirms a payout
refused for want of budget leaves the referral **QUALIFIED, not REJECTED**, so it can
be paid later without recomputing the qualification.

My own new assertions failed first for a self-inflicted reason: they read "committed"
budget state _after_ the same suite had funded +50,000,000 in its own transaction, and
correctly reported 100,000,000 and 2 audit rows. The baseline is now captured into a
temp table before anything mutates it, which also makes the assertions order
independent. I briefly suspected the pooled runner was leaking transactions across
suites; it was not - session-mode pooler, one child, a fresh `Client` per suite. The
defect was mine.

The live database was verified unchanged after two consecutive full runs: 50,000,000 /
50,000,000 / active, one funding audit row, zero referrals, zero rewards.

## Verification

- 19/19 pgTAP suites, **414 assertions**, 0 failures
- 245 Vitest tests, 14 files
- `check:migrations` 189 functions, `check:grants` 91 public functions,
  `check:data-api` 83 tables, `check:bundle` clean
- typecheck, lint, build, `prettier --check` clean
- Deployed state confirmed by direct query after two consecutive test runs
- Guard proven by re-executing the migration block: budget and audit count unchanged

## Still open

- No scheduler exists, so `claim_due_referral_payouts` remains operator-triggered. Until
  it runs, a referral qualified while the worker was down waits for it. The qualifying
  transaction is no longer at risk either way.
- `paid_perk_products` is still empty; no perk can be purchased and none has been
  invented.

---

## CR-0029 - Paid perks: API, purchase flow and UI

Complete. No SQL was added; CR-0017 and CR-0018 already shipped the whole database
contract and this CR is the missing application layer over it.

**Routes.** `GET`/`POST /api/perks`, `POST /api/perks/orders/[orderId]/purchase`,
`POST /api/perks/orders/[orderId]/cancel`, `POST /api/donations`. **UI.** `/perks`
with the catalogue, entitlements, order history and spend history, plus the
two-step purchase flow.

**Law 47 is enforced structurally, not by convention.** Creating an order takes a
product **code and no amount**; confirming takes an **order id and no amount**, and
the tendered figure is read back from the order the database priced.
`purchase_with_funding` then independently re-reads the order and the product and
refuses if the three disagree. Cancelling is not refunding: `cancel_paid_perk_order`
refuses anything not `PENDING`, and `refund_funding_spend` is actor-gated, so **there
is deliberately no user-facing refund route**.

Measured end to end against the live database in a rolled-back transaction: create →
`PENDING` at 75,000; purchase → `FULFILLED`, spend `PERK_PURCHASE`, entitlement
`ACTIVE`; replayed idempotency key → the same order.

**Q-41 - a status word invented where a database value belonged.** `paid_order_status`
has no `PAID`; it is PENDING, CONFIRMED, FULFILLED, REFUNDED, CANCELLED. The display
map had `PAID → brand`, so every genuinely paid order would have missed the map,
fallen through to the fail-closed branch and rendered **neutral grey reading
"status: confirmed"** — paid money displayed as unpaid. The same map invented a
`PERK_REFUND` purpose that does not exist, and the purchase response returned a
literal `PAID`, then `CONFIRMED`, when a purchase actually leaves the order
`FULFILLED`.

That is the third instance of one defect, after CR-0027's `reward.state ===
'SETTLED'`. Each comparison is always false so nothing throws, and each sat beside
fail-closed handling that made it look deliberate. The response now returns **no
status at all**, because `purchase_with_funding` returns a spend row and not the
order, so the handler never read one.

`ORDER_STATUSES` is exported, pinned to the real enum, and three tests assert the map
covers every real status and invents none. The `PAID` mapping was re-injected and the
suite re-run to prove it fails: 2 failed, restored, 22/22 pass, file byte-identical.

**Other honesty decisions.** No product is seeded and the empty state says so.
`describeBilling` returns `recurring: false` for every input because nothing renews a
subscription, and affirmatively denies the renewal claim. An entitlement is not money
and is deliberately not mapped through `MoneyState`. `is_refund` makes a refund a
credit, never a second debit. Amounts are raw minor units like every other surface.

**Also fixed:** the product-code schema was `min(2).max(64)`, which accepted uppercase
and an overflow that `paid_perk_products_code_shape` (`^[a-z0-9_]{2,60}$`) rejects
with a raw 23514. Path segments are now UUID-validated rather than cast.

**Verification:** 19/19 pgTAP suites, 414 assertions, 0 failures. 267 Vitest tests
(was 245). `check:migrations` 189 fns, `check:grants` 91 public fns, `check:data-api`
83 tables, `check:bundle` clean. Typecheck, lint, build, prettier clean.

**Still open:** `paid_perk_products` is empty, so nothing can be bought until real
products and prices exist — the path is proven and the catalogue is the only missing
input. No subscription renewal. Refunds have no admin UI yet.

Next atomic task: **review Storage policies and validated media upload**, then the
moderation console. `attach_review_comment_media` records metadata for an object
nothing uploads, which is Q-38's shape again.

---

## Session - 2026-10-04 - CPX Research adapter, verified end to end (CR-0031)

Date: 2026-10-04
Agent/owner: AI coding agent (session with the repository owner)
Phase: 3 - Providers (M3)
Milestone: M3 (provider integration) - first real vendor authenticated, still not live

**A real callback is now authenticated end to end.** This is the first time that line in
the progress notes has been true. `app.provider_callbacks` id 5 records
`verification_result = VERIFIED` with `signature_algorithm = md5(trans_id-secure_hash)`,
from CPX's own test tool against the production host. That settles the signing question
CR-0030 left open, and CR-0030's routing fix is confirmed live: the endpoint returns
`200 {"status":"ok"}` where it previously returned `307` to sign-in and then `405`.

**Three defects were found by that traffic, and all three were invisible from outside.**
Each returned `200 {"status":"ok"}` to CPX with the dashboard showing revenue credited,
while Averra created nothing.

1. **Every callback was rejected on amount precision.** CPX sent `amount_local=662.6500`
   (four decimals) for a 0.50 USD conversion, while `amount_usd` arrived with two. A fixed
   scale of 2 refused it, so `handleCallback` returned null and every callback recorded
   `NORMALIZATION_FAILED`. Fixed by stripping trailing zeros - exact, not rounding;
   `662.6501` and `10.1230` are still refused.
2. **The fraud reversal would have been discarded entirely.** CPX reverses with
   `status=-2`, documented only in a second advisory panel, not in their field list.
   Matching `'2'` alone classified it UNKNOWN and dropped it with no conversion row, so
   the 15-60 day clawback would have silently never happened. Even once classified, the
   reversal reuses the SAME `trans_id`, so law 5's unique index returned the original
   conversion as a duplicate - also silently discarding it. **Fixed in CR-0032**; see
   that session below.
3. **The source-IP check compared the wrong machine.** The published whitelist was
   compared against `ip_click`, which is the _end user's_ address. The live postback came
   from `44.204.183.114`, which CPX does not publish - so gating on that list would have
   dropped a real conversion and every one behind it.

Also fixed: `claimed_event_id` was null on a verified callback because CPX sends
`trans_id`, not `event_id`.

**The misconfigured URL was measured, not argued.** An unauthenticated probe to
`/callbacks/cpx` returned `200 {"status":"ok"}`, byte-identical to a working request, and
wrote **zero** rows - the unknown-provider rejection precedes evidence capture. A green
tick in the vendor dashboard and an empty table are the same event. The acceptance check
for this integration is a table read, never an HTTP status.

**Verification:** 19/19 pgTAP suites, 414 assertions, 0 failures. 19 Vitest files (was
18). Typecheck, lint, build, prettier clean; `check:migrations` 189 fns, `check:grants`
91 public fns, `check:data-api` 83 tables. Every fix was proven by re-injecting its
defect and confirming the suite fails, then restoring - including deleting the route's
`GET` export to reproduce the 405. The real payload is kept verbatim as a fixture,
because both the amount and the IP defect were invisible to invented payloads.

**What did not change, deliberately.** `cpx_research` is still `CANDIDATE`. All seven doc
07 gate timestamps are null, `canProduceReward()` is false, and
`provider:cpx_research` does not exist, so nothing can pay. `CONVERSIONS` is 0.

**Still open, and blocking before `INTEGRATION_TESTING`:**

- **CPX contradicts itself about `status=1`** - "1 = completed" in the field list,
  "`&status=1` (pending)" in the advisory panel. We treat `status=1` + `type=complete` as
  payable. If `1` can mean pending, an unfinished survey could be paid. **Needs written
  confirmation from CPX**; the test tool cannot distinguish the two.
- **Migration 057, the append-only reversal.** `reverses_conversion_id`, a `:2` / `:-2`
  event suffix so the follow-up is not collapsed by `uq_provider_conversions_event`, and
  `apply_provider_reversal` calling `reverse_conversion`. Gated on the point above.
- **Script-tag issuance and `subid_1` binding.** The live postback carried an empty
  `subid_1`, so no event can resolve a paying user and the callback correctly landed as
  evidence with `UNRESOLVED_TRACKING_ID`. Nothing is payable end to end until this exists.
- **Three probe rows are permanently in `provider_callbacks`.** Written by diagnostic
  requests during this session, correctly rejected, and undeletable by
  `trg_provider_callbacks_immutable`. They carry `trans_id` of `probe`, `probe4` and
  `probe`. An auditor reading by hand will meet them.

Next atomic task: **ask CPX to confirm `status=1`, then build migration 057.** The
reversal clawback is the only path by which money already credited comes back, and it
does not exist yet.

---

## Session - 2026-10-04 - Append-only provider reversals (CR-0032)

CR-0031 classified `status=-2` as a reversal and then stopped, because classifying it was
not the same as being able to record it. It could not. This session closed that.

**The defect that would have cost money.** CPX re-notifies a withdrawn transaction 15-60
days later using the **same `trans_id`**. Law 5's unique index on
`(provider_id, provider_event_id)` therefore returned the _original_ conversion as a
`DUPLICATE`, and the fraud clawback was discarded with no reversal row, no
`reverse_conversion` call, and no error anywhere - while CPX's dashboard showed the
reversal delivered.

This was survivable only by accident: while `cpx_research` is `CANDIDATE` no conversion
becomes a reward, so there is nothing to claw back. The day a provider goes `LIVE` it
stops being a no-op.

**Why append-only.** Letting the reversal `UPDATE` the original row would be a financial
rewrite (law 42): the row that said `VALIDATED` stops saying so, and the record of what
the vendor originally asserted is gone. Law 7 wants a compensating event. So the reversal
gets **its own row**, its own event identity (`trans_id:-2`), and a new self-referencing
`reverses_conversion_id`. The original is marked `REVERSED` only by the command that has
actually moved the money, never by the arrival of the notification.

**The gate earned its place.** The first attempt appended a parameter to migration 034's
`record_provider_conversion`. `check:migrations` refused the build:

> migration 035 calls `record_provider_conversion` with 14 argument(s) but migration 057
> declares 15 input parameter(s). This compiles and fails at runtime.

Migration 035 is a `public` PostgREST wrapper passing 14 positional arguments, so this
would have compiled and then failed at runtime. Migration 034 stays byte-identical and the
new command is additive.

**Two bugs found in existing code while doing it.**

1. A reversal would have been downgraded to `RECEIVED`. `ingest.ts` computed
   `p_status = mayConvert ? 'VALIDATED' : 'RECEIVED'`, so a reversal arriving while the
   provider was not `LIVE` recorded as `RECEIVED` - a live-looking value.
2. The clawback would have been skipped on **replay**. The reversal branch sits _before_
   the duplicate and user-resolution early returns, because providers re-notify and the
   second delivery must still claw back.

**Deliberate non-gate.** `apply_provider_reversal` runs before `canProduceReward`. A
`SUSPENDED` provider must still claw back money credited while it was `LIVE`; gating
reversals on the lifecycle would mean suspending a provider _protects_ its payouts.

**An unmatched reversal is recorded, not refused.** A vendor can withdraw a transaction
whose completion never reached us. Raising would destroy the only evidence the withdrawal
was offered - the exact mistake this migration exists to prevent. The row is written with
a `NULL` link and the command reports `no_reward` rather than inventing an original.

### Applied to the live database

Migrations **057** and **058** are applied and recorded in `supabase_migrations`. `supabase
db push` could not be used - it requires an interactive confirmation that will not run
non-interactively - so they were applied with a throwaway script, which has since been
deleted. **Recorded, not merely applied**: an unrecorded version would be re-applied by
the next `db push`.

Verified against the deployed database, not the files, per the applied-migration-is-frozen
rule.

### Verification

| Gate                                   | Result                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| `npm run test:db`                      | **20 suites, 436 assertions, 0 failures** (was 19/414) |
| `npm test`                             | 19 files, 108 tests passing                            |
| `npm run typecheck` / `lint` / `build` | clean                                                  |
| `check:migrations`                     | 194 functions, 0 errors                                |
| `check:grants`                         | 94 public functions, 0 errors                          |
| `check:data-api`                       | 83 tables, no direct access                            |

New suite `supabase/tests/provider_reversal.sql`, 22 assertions. **Both halves proven by
re-injection**: restoring the bare `trans_id` fails three assertions with the core one
reporting `have: true, want: false` - the duplicate-discard defect reproducing exactly.
Reverting the adapter suffix fails the adapter-side assertion. Both restored, green
re-confirmed.

### Three pgTAP facts this suite established

1. **`plan()` must precede every assertion.** It sat after the first assertion, and the
   whole suite failed as `produced no assertions at all` - which reads like a suite that
   never ran rather than an ordering mistake.
2. **`col_is_fk`, `has_check` and `pg_constraint.consrc` do not exist here.** The first
   two are absent from the deployed pgTAP build (and their arity varies between versions);
   `consrc` was removed in PostgreSQL 12. All three assertions are rewritten against
   `pg_constraint` and `pg_get_constraintdef`, which are version-proof.
3. **`null_value_not_allowed` is a condition NAME for SQLSTATE 22004**, not a distinct
   code, so a blank reason code and a NULL one both report `22004`.

### A leaked-fixture defect, in the runner and in this suite

Three aborted runs (the unavailable-pgTAP-function errors above) each committed a partial
fixture. The runner wraps each suite in `begin/rollback`, which protects a **passing**
suite only - a suite that _errors_ mid-way leaves rows behind. The next run then correctly
reported the completion as a `DUPLICATE`: a failure caused by the previous failure, which
is precisely what gets misread as a real defect. The three rows were deleted and the suite
now deletes its own prefix first. **The 2 genuine live CPX conversions were untouched** -
confirmed before and after.

### What did not change, deliberately

`cpx_research` is still `CANDIDATE`, all seven doc 07 gate timestamps are still null, and
`provider:cpx_research` still does not exist. Migrations 057/058 make the clawback
_possible_; they do not make it _reachable_, because no conversion can currently become
money. Reversals also inherit no user (`user_id = null`, `tracking_id = null`): a reversal
withdraws a conversion, it does not attribute a new one.

Still blocked on **written confirmation from CPX about `status=1`**.

Next atomic task: **issue the script tag and bind `subid_1`.** Every conversion currently
lands as evidence with `UNRESOLVED_TRACKING_ID`, so nothing is payable end to end until a
click can resolve a user.
