# CR-0016 - Reviews & Community system (doc 86)

Date: 2026-10-02
Status: APPLIED to migrations 038-039 and supabase/tests/reviews.sql. Database
execution verified live. API routes and UI are NOT part of this change record.

## What prompted this

The full specification corpus was audited against the implementation to answer
"is everything in AVERRA_FULL_PLAN built?". Most of it is, and the audit found
several requirements already satisfied that were worth recording as verified
rather than assumed:

    withdrawal 3-field model   withdrawal_status + payment_settlement_status +
                               reconciliation_status all present (migrations
                               006, 037 doc revision, ADR-0003); a test asserts
                               ELIGIBILITY_CHECK is NOT a withdrawal_status value
    15% service fee            FEE_BASIS_POINTS = 1500, PLATFORM_SERVICE_MAINTENANCE_FEE
                               ledger source type, fee_records split_exact
    deposit token tiers        deposit_token_candidates + deposit_token_configs
    human-only support         app.author_kind has no 'SYSTEM' member, so no
                               automated process can post a support reply
    admin RBAC                 admin_capabilities / admin_roles / admin_role_capabilities
                               / admin_users / approval_requests / approval_decisions

Three large, fully-specified subsystems were NOT built at all. This record covers
the first, which is the one with no financial authority and therefore the one that
could be built without touching money:

    Reviews & Community (doc 86)          ABSENT - no review* table existed
    Paid perks / donations (doc 83)       ABSENT - paid_perk_orders, paid_entitlements,
                                          donations, user_funding_accounts,
                                          user_funding_balances all missing, and
                                          USER_FUNDING_SPEND is declared in
                                          app.ledger_source_type but used NOWHERE
    Mining Game Three.js shell (doc 17)   ABSENT - three@0.186.1 is installed but
                                          there is no `three` import anywhere in
                                          src/; src/components/game/ holds one 2D
                                          component (GameShell.tsx)

The remaining two are named here as the next atomic tasks, not silently left.

## What was built

### Migration 038 - reviews_foundation.sql

The six logical tables of doc 86 DATABASE MODEL, field for field, plus seven
enums, indexes, RLS and grants:

    app.reviews, app.review_media, app.review_comments,
    app.review_comment_media, app.review_reports, app.review_moderation_actions

### Migration 039 - review_functions.sql

Seven `app_private` commands, six same-signature `public` entry points (the
migration-035 pattern, because PostgREST resolves RPCs only against an exposed
schema), and five `public` read wrappers, plus one revocation-aware capability
guard. 20 functions in total.

### supabase/tests/reviews.sql

37 assertions covering schema, vocabulary, structural constraints, command
behaviour, moderation authority and the public projection.

## The laws this enforces, and how

The point of encoding these structurally is that they hold even if a later route
forgets to check. Each is asserted by a test.

**Law 63 - reviews never mutate financial state.** No column in this subsystem can
hold a financial amount, and no review table has a foreign key to any financial
table. Asserted twice: by column name pattern, and by joining `pg_constraint` to
the set of financial relations. The second is the stronger half, because it is
what stops a public review surface being joined to a private ledger row.

**Law 64 - Verified Experience is verified ACTIVITY, not endorsement.** The review
stores an opaque TEXT reference to the qualifying event, deliberately not a uuid
foreign key, so a public read cannot resolve it. At write time, `submit_review`
checks the event actually exists AND belongs to the author; if not, the write is
REFUSED rather than downgraded to UNVERIFIED, because a review that silently loses
its badge is a lie the author did not write. `review_experience_is_valid` returns
false for both "does not exist" and "is not yours", so a review cannot be used to
probe whether an arbitrary uuid exists elsewhere in the platform.

**Law 65 - no financial reward for positive reviews.** There is no reward, budget
or ledger reference column anywhere in these two migrations, so the rule cannot be
broken by a later writer without a schema change.

**Law 69 - public APIs never expose private financial or support evidence.** The
public projection omits `verified_experience_id` entirely; only the moderator
surface returns it.

**Law 67 - moderation is human.** `review_moderation_actions` is append-only via
`app_private.reject_mutation()`, so a correction is a NEW action (RESTORE after
HIDE) and never an edit of the old one. The action vocabulary is validated against
the target kind and a mismatch is refused rather than coerced.

## Decisions taken, and why

**A review is created PENDING, not PUBLISHED.** Doc 86 requires human authority
over publication (law 67) and states that "public visibility is driven by
publication/moderation status, not by client assumptions". Fail-closed is the only
version of that a database can guarantee on its own. The consequence was noted and
closed in the same change: without a way to publish, a PENDING default would mean
nothing ever becomes visible, so `list_reviews_awaiting_publication` exists. Doc 86
permits deterministic non-AI automation for technical safeguards, so a later,
separately-approved auto-publish rule can be added without a schema change.

**`review_experience_type` has four values, not five.** Doc 86 gives an
illustrative list including a Mining Game purchase. That value is NOT modelled,
because no game-purchase table exists yet (docs 83/75 are unbuilt) and inventing it
would mean claiming a verification the database cannot perform. It joins the enum
when the funding-spend layer lands. A test asserts the enum's exact contents, so
adding it is a deliberate act rather than a drift.

**Media has no HIDDEN state, and asking for one is an error.** An image is
PENDING, APPROVED, REJECTED or REMOVED. Coercing HIDE into REMOVED would make the
moderation record say something the moderator did not choose.

**Reports are resolved separately from content.** Dismissing a report is not the
same judgement as deciding the content is fine, so `resolve_review_report` is its
own command and doc 86's own `status`/`resolved_by`/`resolved_at` columns carry it.

**One review per qualifying event.** A partial unique index on
(user_id, verified_experience_type, verified_experience_id) implements doc 86
ANTI-MANIPULATION's "multiple reviews tied to the same qualifying event", without
constraining ordinary unverified reviews.

**A self-moderation policy gap was NOT invented.** Doc 86 and doc 87 require human
moderation and least privilege but do not say whether a moderator may act on their
own review. No rule was added, because inventing one is not this change's
authority. It is flagged here as an open policy question for a human decision.

## Verification

    database                       live project apdjiraovzersfqpbzhm
    migrations applied             038, 039 (db push; --dry-run listed exactly these two)
    migration drift                39 local files / 39 applied rows, none missing
    suites                         11/11 executed
    assertions                     213, failed 0    (was 176 across 10 suites)
    reviews.sql                    37/37
    injected-defect proof          dropped reviews_verification_evidence_consistent
                                   -> exactly assertion 18 failed, by name and number;
                                   restored byte-identically -> 37/37 again
    npm run check:migrations       OK - 133 functions, 0 errors   (was 113)
    npm run check:grants           OK - 69 public functions, 0 errors   (was 57)
    npm run check:data-api         OK - 76 app tables, no direct access   (was 70)
    npm test                       176 vitest tests, passing
    npm run build                  Compiled successfully
    prettier --check .             clean

The injection proof follows the rule this repository learned twice over: a check
that has never been shown to fail proves nothing. Worth recording alongside it: the
first failure this suite reported was a defect in the TEST, not the schema. Two
calls passed the idempotency key positionally into `p_title`, so the command
correctly refused them with "an idempotency key is required". They are now written
in named-notation, which is what the suite uses for any call that skips an optional
parameter. Positional-argument drift is exactly the class of mistake this project
has been bitten by before.

## Two defects found while building this

Both are recorded in docs/DISCREPANCIES.md.

**1. `app.has_capability()` does not honour revocation.** It joins `admin_users` to
`admin_role_capabilities` filtered only on `user_id`, with no `revoked_at is null`
predicate, so a REVOKED operator still passes it. The TypeScript guard in
`src/lib/auth/capabilities.ts` explicitly does filter revocation ("a revoked
assignment is not a role"), so the two disagree about what authorization means.
`has_capability` is currently unreachable - it reads `auth.uid()`, which is NULL on
the service-role connection every route uses - but its own comment invites future
use: "Server-side guards and RLS must use these exact codes." A guard that appears
to enforce authorization and does not is the worst kind of latent security bug, so
the new `app_private.operator_has_capability(p_user_id, p_capability)` DOES filter
`revoked_at`, and a test asserts a non-holder is refused.

**2. `prettier --check .` failed because an exclusion lived only in
`.git/info/exclude`.** `.kilo/worktrees/` was excluded from git by a local,
per-clone, uncommitted file. Prettier honours `.gitignore` and `.prettierignore`,
not `.git/info/exclude`, so it walked into a stray agent worktree and found
unformatted YAML/JSON/Markdown there, failing the whole-repository check. The
worktree was removed (it was clean and at main's commit, so nothing was lost) and
`.kilo` was added to the tracked `.prettierignore`. The lesson is the same one Q-30
taught: an exclusion that exists only on one machine is not an exclusion, and a
gate whose inputs are machine-local can fail for reasons no reviewer can see.

## Outstanding

- **API routes and UI are not built.** Doc 86 API SURFACE and doc 10 REVIEWS &
  COMMUNITY UI still need the user endpoints, the report endpoints, the admin
  moderation endpoints and the public review pages. The database layer is now the
  contract for all of them.
- **Supabase Storage policies are not created.** Doc 86 requires deliberate access
  policies on the media bucket; only the metadata and its moderation status are
  modelled here.
- **`GAME_PURCHASE` verified-experience type** waits on docs 83/75.
- **Paid perks, donations and the funding-spend path (doc 83) are still absent.**
  `USER_FUNDING_SPEND` remains an unused enum member. That is the next subsystem,
  and unlike this one it touches money.
- **The Three.js shell (doc 17, milestone M5) is still absent.**

## Files changed

    supabase/migrations/20260930000038_reviews_foundation.sql   new
    supabase/migrations/20260930000039_review_functions.sql     new
    supabase/tests/reviews.sql                                  new
    .prettierignore                                             added .kilo
    docs/DISCREPANCIES.md                                       Q-31, Q-32
    docs/PROGRESS.md                                            new (doc 80 artifact)
    docs/change-records/CR-0016-reviews-community-system.md      new
