# CR-0005: Support ticket surfaces and Phase 5 Mining Game foundation

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 12_TASK_SYSTEM (carried), 15-24 MINING GAME, 31 SERVER AUTHORITY,
32 ANTI_ABUSE, 44 SUPPORT, 71_ARCHITECTURAL_LAWS laws 25, 26, 58, 59

## Part 1: Support surfaces

Closes the two remaining dead links from CR-0004.

- `/support/new` and `/support/[id]` pages.
- `POST /api/support/tickets/[id]`, which calls `post_user_reply` only.
- `NewTicketForm` and `TicketReply` client components.
- The thread shows author kind explicitly, so a human agent's reply is visibly
  distinct from the user's own message.

The user-reply route can only post a `USER` message. It cannot post an agent
reply: that path is `post_agent_reply`, admin-only, and requires a verified human
agent server-side. There is no generated reply anywhere in the thread, because
an unattributed support message is unauditable and the schema rejects it.

## Part 2: Mining Game foundation

- Migration 018: eight tables, 25 constraints.
- Migration 019: `assert_game_version`, `regenerate_energy`, `perform_game_action`.
- Migration 020: seed configuration, inactive except `ore_basic`.
- `GET|POST /api/game`, `GameShell`, and the `/game` page.
- 15 pgTAP assertions.

## Law 26 is structural, not asserted in a comment

"Game resources are NOT money" is normally a comment. Here it is enforced three
ways, and the pgTAP suite proves each against the live catalogue rather than
trusting the source:

1. **No game table can hold money.** A test asserts that zero columns across
   `game_*` match ledger/wallet/balance/amount/credited patterns.
2. **No game table references a funding source.** Zero foreign keys to
   `reward_sources`, so a game row cannot even name a payout source.
3. **No game function reaches the ledger.** `pg_proc.prosrc` is inspected for
   `grant_reward`, `post_ledger_entry`, `transition_reward` and
   `create_withdrawal_request`. Zero matches.

I verified this independently: the only occurrences of those identifiers in
migration 019 are inside one comment line.

## Doc 31 request validation, implemented in order

`perform_game_action` follows the documented sequence exactly:

1. Authenticate the user.
2. Validate the action ID for idempotency BEFORE applying anything, so a retry
   is a no-op rather than a second production tick or a second energy spend.
3. Load current state under `FOR UPDATE`.
4. Check the version and prerequisites.
5. Apply the transition atomically.
6. Emit the event in the same transaction.
7. Return the authoritative state and version.

### Energy is recomputed server-side, always

`regenerate_energy` runs on every action. The client's countdown is a local
animation from a server timestamp, and the server recomputes on every action, so
tampering with it buys nothing.

Two details worth recording:

- Elapsed time is clamped at zero. A backwards clock cannot remove energy.
- `energy_last_calculated_at` advances on EVERY call, including when energy is
  already full. If it only advanced on a gain, a later spend would compute
  regeneration from a stale starting point and grant a windfall.

### Production cannot be forged

The COLLECT branch accepts no quantity parameter at all. Output is derived from
elapsed server time, production interval, machine level and condition, all of
which are server rows. The clock advances by whole ticks only, so fractional
progress is preserved and repeated collects cannot farm a partial tick.

## Defect caught during implementation

- `insufficient_energy` did not exist in `ApiErrorCode`, and reusing
  `insufficient_funds` would have been wrong: energy is a virtual resource, not
  money, and reporting it as a funds problem would misdescribe it. A distinct
  code was added.
- Lint caught `setState` inside an effect in `GameShell`; the initial load is
  now deferred.

## Gate status

Typecheck, lint, 128 unit tests, production build, migration structure check,
format check and bundle secret scan all pass. 38 SQL functions structurally valid.

## Outstanding

- No machine deployment flow yet. `game_players` and `game_machines` are created
  by an operator, so a new player sees "your mine is not set up yet". Phase 6.
- No Three.js 3D viewport yet. The shell is a card-based authoritative HUD, which
  is honest and functional; doc 17's renderer is Phase 6 work.
- No upgrade command function. The tables and definitions exist; the
  `UPGRADE` action is not yet handled by `perform_game_action`.
- Game economy balance is unapproved, so all machine types except the basic
  extractor seed inactive.
- pgTAP is still unexecuted: 105 assertions across seven files, blocked on
  Docker.
- Migrations remain unpushed by direction.
