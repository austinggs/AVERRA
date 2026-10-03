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
2. **No live provider is onboarded.** Doc 07's decision gates are unexercised:
   no real callback has been authenticated end to end.
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
