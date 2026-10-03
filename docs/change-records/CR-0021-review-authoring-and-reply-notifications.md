# CR-0021 - Review authoring commands and the reply outbox (migration 042)

Date: 2026-10-03
Status: APPLIED to `supabase/migrations/20260930000042_review_authoring.sql` and
`supabase/tests/review_authoring.sql`. Routes and the outbox handler added. **Executed live against the project
database: 13 suites / 274 assertions / 0 failures.**

## What prompted this

CR-0016 shipped migration 038 (tables) and 039 (20 functions). Doc 86's API
SURFACE lists sixteen endpoints. Five of them had **nothing to call**, because no
authoring command was ever written:

    PATCH /reviews/:id                  -> update_review
    DELETE /reviews/:id                 -> delete_review
    PATCH /reviews/comments/:id         -> update_review_comment
    DELETE /reviews/comments/:id        -> delete_review_comment
    POST  /reviews/comments/:id/media   -> attach_review_comment_media

The last is the notable one. Migration 038 created `app.review_comment_media`
with its own status column, its own indexes, its own MIME CHECK and its own
storage-path constraints - and **nothing ever wrote to it**. Doc 86 IMAGE
SUPPORT says "Replies may also contain images", so that table was unreachable by
construction: fully specified, fully constrained, permanently empty.

## Why the reply notification is a TRIGGER

Migration 039 writes no outbox event, so `submit_review_comment` has nothing to
notify from. The obvious fix is `create or replace` on that function and add the
insert - which means retyping an eighty-line body that is already applied and
reviewed. AGENTS.md records that re-typing a function body to "simplify" it is how
the `grant_reward` wrapper was nearly corrupted, and two migrations were silently
corrupted by a stale editor offset.

A trigger avoids all of that. It is additive, it fires inside the same transaction
as the INSERT **by construction** rather than by remembering to add a line, and
migration 039 is left byte-identical. The outbox guarantee is satisfied
structurally.

Three rules in the trigger, each a decision rather than a default:

1. **No self-notification.** An author replying to their own review gets nothing.
2. **Only the review author is notified.** A reply-to-a-reply is included, because
   doc 86 describes a thread and a thread nobody is alerted to is a conversation
   nobody is in. A second recipient path is not stated by the spec, so it was not
   invented.
3. **The payload carries no comment text.** Only ids and the review title. The
   comment is still PENDING at the moment the trigger fires, so its content has
   not been moderated and must not escape through a notification (doc 86 PRIVACY).
   Asserted: `payload ? 'body'` must be false.

## Two design decisions worth stating

**Deletion is SOFT.** `deleted_at` is set and the row stays. Doc 09 TRANSPARENCY
applied to content means the author must still see that their review existed, and
doc 67 requires the moderation trail to survive a takedown. This matches the
`deleted_at` column migration 038 already put on both tables and every read
wrapper in 039 already filters. A second delete is idempotent rather than an
error, because the author's intent is already satisfied.

**A PUBLISHED review cannot be edited in place.** The command refuses it.
Rewriting text other people have already read and replied to is a history rewrite
wearing a UI. The honest sequence is to publish, and if it was wrong, take it down
explicitly and say so.

## The gates, and proving them

`check:migrations` and `check:grants` are the two structural gates that could
catch a corrupted 042, and AGENTS.md is explicit that a gate never seen failing
proves nothing. An orphan `$$;` was injected into 042 and both checks were run:

    20260930000042_review_authoring.sql   fns=11 FAIL (2)
        - orphan $$; with no open function (line 434)
        - odd number of $$ delimiters (23)
    check-migrations: FAILED - 154 functions across all migrations, 2 error(s).

Restored, and both gates report clean at **154 functions** (was 143) and **80
public functions** (was 75).

## Verification

The pgTAP suites had never been executed against a live database before this
change. They now have been, and that is what turned three of the assertions below
from "written" into "proven".

    pooled connection      aws-1-eu-west-1.pooler.supabase.com:5432 (session mode)
    suites                13/13 executed
    assertions            274, failed 0   (was 248 across 12 suites)
    review_authoring.sql  26/26
    migration 042         applied; it was the ONLY pending migration

    check:migrations    OK - 154 functions, 0 errors (was 143)
    check:grants        OK - 80 public functions, 0 errors (was 75)
    check:data-api      OK - 81 app tables, no direct access
    typecheck           clean
    lint                clean
    test                239 passed / 13 files
    build               Compiled successfully
    prettier --check .  All matched files use Prettier code style

`npm run test:db:pooled` is the new entry point. `tools/run-db-tests-pooled.mjs`
composes the pooler URL from `.env.local` (the password) and
`supabase/.temp/pooler-url` (the host, user and port), percent-encodes the
userinfo, and passes the result to the existing runner as a child-process
environment variable. The URL is never printed, logged or written to disk. This is
the Q-16 split resolved: for the life of the project the two halves of the
connection string lived in different files and neither worked alone.

## Three defects found by RUNNING the suite, not by reading it

**1. The self-notification assertion could not fail.** This is the serious one,
and it is recorded as Q-36. The assertion created the comment and counted the
outbox event in the SAME statement. PostgreSQL evaluates the outer aggregate
against that statement's snapshot, which predates the row the subquery inserts, so
the count was zero **whether or not the trigger fired**. Delete the
self-notification guard entirely and the test still passes.

It was caught by the CONTROL assertion beside it, which created a reply from a
different user against the same review and expected 1:

    not ok 25 - CONTROL: a reply from another user DOES enqueue
        have: 0
        want: 1

The control owed one and got zero - the signature of a visibility problem
rather than a trigger problem. Fixed by splitting creation and counting into
separate statements with the id captured in a temporary table between them.

**2. Adding COMMUNITY broke an existing suite.** Recorded as Q-37.
`notifications_support.sql` asserted the enum equalled the eight-value doc 45
list. Doc 45 REVIEW NOTIFICATIONS explicitly authorises reply alerts, so the ninth
value is justified - but the tempting fix was to relax the assertion to a
containment check, which would also pass if someone deleted SECURITY. The list
stays exact, now with nine values and the doc 45 citation.

**3. `composite IS NOT NULL` is not "the row exists".** The idempotent-delete
assertion used `delete_review(...) is not null`. In PostgreSQL that is true only
when EVERY field of the composite is non-null, and `app.reviews` has nullable
columns, so it returned false on a perfectly good row. Rewritten to compare the
returned `id`, which also tests what it claims: that the second delete returns the
same row instead of raising.

The plan count was also wrong first time round - declared 24 against an actual 26 -
and is now counted mechanically against the file rather than estimated.

## Invariants held

- **Doc 67 BOLA / IDOR** - every command scopes its lookup by BOTH the session
  user id and the record id, so another author's row is reported as _unknown_
  rather than _forbidden_. Reporting "forbidden" would confirm the id exists.
- **Law 63** - no authoring command can reach a money primitive, asserted by
  inspecting `pg_proc.prosrc` for `post_ledger_entry`, `grant_reward`,
  `create_withdrawal_request`, `ledger_entries` and `paid_perk_orders`.
- **Doc 09 / doc 67** - history is never rewritten: the deleted row still exists.
- **Doc 86 PRIVACY** - the notification payload carries no unmoderated text.
- **Law 67** - no AI decision anywhere; moderation remains a human action recorded
  in an append-only log.
- Every `public` wrapper revokes `public, anon, authenticated` **before** granting
  to `service_role`, the migration-036 lesson from Q-22.

## Outstanding

- **Supabase Storage policies and the media upload route are still not built.**
  `attach_review_comment_media` records metadata for an object that nothing yet
  uploads. Media renders as a text placeholder.
- **The review moderation console UI is not built** - the API queues and the
  moderation action exist; no `src/app/admin` pages exist at all.
- `notification_category` gained `COMMUNITY`. `SYSTEM` would have worked, but a
  user filtering alerts should be able to separate "someone replied to you" from
  generic platform notices.
- The database password was shared in a chat conversation while unblocking this
  run. It is not in any tracked file and should be rotated. That is a
  recommendation, not a blocker.

## One observed flake, recorded rather than papered over

One run during this session reported **264 assertions with 0 failures** and
`RESULT: FAIL`, against a plan of 274. Ten assertions from one suite never ran.

`tools/run-db-tests.mjs` opens a connection with `connectionTimeoutMillis:
30000`. That run was launched immediately after a production build, so the pooler
was handling load while thirteen suites each opened their own connection; one
connection timed out, its suite aborted mid-way, and the runner reported the
partial count and FAILED. Two subsequent clean runs returned 274 both times.

This is the runner behaving correctly, not a broken test: the failure mode this
repository cares about is a suite that quietly stops asserting, and the plan
mismatch is precisely the guard against it. No retry was added, because a test
that can pass by retrying is worse than an honest intermittent failure.

## Files changed

    supabase/migrations/20260930000042_review_authoring.sql   new (11 functions)
    supabase/tests/review_authoring.sql                       new (26 assertions)
    src/app/api/reviews/[reviewId]/route.ts                   new (PATCH, DELETE)
    src/app/api/reviews/comments/[commentId]/route.ts          new (PATCH, DELETE)
    src/lib/observability/handlers.ts                          review.comment.added
