# CR-0003: Phase 4 Native Task System

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 12_TASK_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md, 05_REWARD_ECONOMICS.txt,
35_REWARD_ENGINE.txt, 09_USER_EXPERIENCE.txt, 48_DATABASE_SCHEMA.txt,
49_API_SPECIFICATION.txt, 70_ACCEPTANCE_CRITERIA.txt

## What was built

- Migration 016 `task_definitions`, `task_attempts`, `task_verifications`, `task_events`.
- Migration 017 `start_task_attempt`, `submit_task_completion`, `verify_task_completion`.
- `src/lib/tasks/contract.ts`: pure mirrors of the verification rules.
- Routes `GET /api/tasks`, `GET|POST /api/tasks/[id]/start`,
  `POST /api/tasks/attempts/[attemptId]/submit`.
- `/tasks` page, added to the application navigation.
- 27 unit tests and 15 pgTAP assertions.

## The governing decision

Doc 12 states: "Client completion claims are evidence only, never sufficient for
financial credit unless a server verification rule explicitly says so."

Rather than treat that as a procedure, it is enforced in four places:

1. **A task that pays must declare a verification mechanism.**
   `task_definitions_paying_task_needs_verification` refuses a paying task whose
   mechanism is `NONE`. There is no shape of an unverifiable payout in the schema.

2. **A self-attested task can never auto-verify.**
   `task_definitions_self_attested_never_auto_verifies` refuses
   `SELF_ATTESTED` with `auto_verify = true`.

3. **Verification repeats the rule at the decision point.**
   `verify_task_completion` raises if asked to PASS a `SELF_ATTESTED` or `NONE`
   task, so a caller cannot bypass the constraint by ignoring it.

4. **Submission can never move money.**
   `submit_task_completion` writes evidence and sets `SUBMITTED`. It has no
   call to `grant_reward` and no path to `post_ledger_entry`.

The reward, when verification passes, is created by `grant_reward`, so the
funding source, budget decrement, cap check and ledger entry all come from the
one authoritative Reward Engine path. There is no second money path for tasks.

## Other invariants

- Duration for the impossible-time check is measured by the server from its own
  `started_at`. The client's reported duration is stored inside `client_claim`
  as an assertion and is never read for the decision.
- Idempotency: the reward uses `p_idempotency_key => 'task-reward:' || attempt_id`,
  so a retried verification cannot pay twice.
- A paying task must name a `reward_sources` row (law 10), a unit, and a positive
  amount.
- `task_verifications` and `task_events` are append-only via `reject_mutation`.
- RLS is enabled on all four tables; `anon` and `authenticated` have no execute
  privilege on any of the three command functions.
- User-facing copy never describes a submitted claim as paid. `REJECTED`,
  `EXPIRED` and `ABANDONED` explicitly state that no reward was paid.

## Gate status

Typecheck, lint, 128 unit tests, production build, migration structure check and
format check all pass.

## Outstanding

- The 15 pgTAP assertions have not been executed; Docker is unavailable on the
  development machine. The total unexecuted pgTAP count is now 93 across six files.
- No task definition is seeded. Seeding requires an approved funding source and
  an approved reward amount, which is a commercial decision, not an
  implementation one.
- An admin verification surface is not yet built. `verify_task_completion` is
  reachable only by a server-side worker or an authorized operator, so a reviewer
  cannot yet decide a claim from the UI.
- Migrations remain unpushed by direction.
