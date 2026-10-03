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

| Area                                                              | Phase / Milestone | State                                                                     |
| ----------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| Repository, CI/CD, observability, contracts, source-of-truth docs | 0 / M1            | COMPLETE                                                                  |
| Identity, profiles, sessions, navigation                          | 1 / M1            | COMPLETE                                                                  |
| Reward Engine, ledger, financial invariants, audit                | 2 / M2            | VERIFIED                                                                  |
| Provider adapters, offers, surveys, callbacks, reconciliation     | 3 / M3            | COMPLETE (no live provider onboarded)                                     |
| Native tasks, verification, budgets                               | 4 / M4            | VERIFIED                                                                  |
| Mining Game server state, machines, energy, inventory             | 5 / M5            | COMPLETE (server side only)                                               |
| Mining Game Three.js shell, asset pipeline, world                 | 5 / M5            | **ABSENT**                                                                |
| Game expansion: missions, events, achievements, leaderboards      | 6 / M5            | COMPLETE                                                                  |
| Withdrawals, payout destinations, 15% fee, manual payouts         | 7 / M6            | COMPLETE                                                                  |
| User Funding deposits, MiniPay manual, token tiers                | 7 / M6            | COMPLETE                                                                  |
| Daimo deposit/Hurry and automatic payout                          | 7 / M6            | PLANNED (adapter seams only; doc 30 requires provider verification first) |
| Cash Link operations                                              | 7 / M6            | Data model COMPLETE; provider integration PLANNED                         |
| Referrals, gamification, advertiser platform                      | 8                 | COMPLETE                                                                  |
| Fraud/risk, moderation, support, notifications                    | 9                 | VERIFIED                                                                  |
| Reviews & Community (docs 86, 76 addition, 77 addition)           | 9 / M7            | Data + authority layer COMPLETE (CR-0016); API + UI PLANNED               |
| Admin Portal UI (doc 87, 20 modules)                              | 9                 | **ABSENT** (RBAC/dual-approval data model COMPLETE)                       |
| Paid perks, donations, funding spend (doc 83, 75)                 | 8                 | **ABSENT**                                                                |
| Production hardening: security testing, DR, load, runbooks        | 10 / M7           | PLANNED                                                                   |

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
