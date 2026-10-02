# CR-0006: Phase 6 Mining Game expansion

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 24_UPGRADES, 25_MISSIONS, 26_EVENTS, 27_ACHIEVEMENTS,
28_LEADERBOARDS, 31_SERVER_AUTHORITY, 32_ANTI_ABUSE, 71_ARCHITECTURAL_LAWS
law 26

## What this closes

The three gaps recorded as outstanding in CR-0005 are now built:

1. **Machine deployment.** `deploy_machine` creates the player row and places a
   machine. A player can actually start playing.
2. **The upgrade path.** `request_machine_upgrade` makes the upgrade tables
   reachable. Doc 24 requires the request be "checked and committed server-side
   in a single authoritative state transition", which is what it does.
3. **Missions.** `claim_mission` is the doc 25 idempotent claim.

## Migration 021: expansion tables

Missions and progress, achievements and unlocks, event windows, leaderboard
entries, and risk signals. Seven tables, RLS on all of them, no browser-facing
grants.

## Two design decisions worth recording

### The leaderboard score is a GENERATED column

Doc 28 says scores "derive from authoritative game data, not client-submitted
totals". The strongest way to enforce that is to make submission impossible:

```sql
score_xp bigint GENERATED ALWAYS AS (xp) STORED
```

A generated column cannot be written, not even by a bug. This is stronger than
an application-level check, and the pgTAP suite asserts `is_generated = 'ALWAYS'`
against `information_schema` so it cannot be quietly downgraded to a plain column
later.

### Risk signals are append-only

Doc 32 says suspicion "may hold a reward or trigger review" but "does not
silently mutate the financial ledger". `game_risk_signals` has
`trg_game_risk_signals_immutable`, so a recorded signal cannot be quietly
removed or its score rewritten. A hold is evidence, not mutable state.

## Law 26 still holds across the expansion

`claim_mission` pays a GAME RESOURCE into `game_inventory`. It does not pay
money. A mission may carry a `reward_source_id` for a funded financial
promotion, but no function here reads it to move money — a financial reward must
go through the Reward Engine.

The pgTAP suite inspects `pg_proc.prosrc` for `grant_reward`,
`post_ledger_entry`, `create_withdrawal_request` and `transition_reward` across
all three new commands, and asserts zero matches. I verified independently that
the only textual occurrences in migration 022 are inside comments.

## A mission cannot pay twice

Two independent mechanisms, not one:

- The `game_mission_progress_claim_consistent` constraint makes
  `(claim_status = 'CLAIMED')` equivalent to `claimed_at IS NOT NULL`. A claim
  cannot be asserted without evidence.
- `claim_mission` returns early when `claim_status = 'CLAIMED'`, and the action
  ID idempotency check runs before anything else.

Progress also cannot run backwards
(`game_mission_progress_non_negative`), so a replayed event cannot reduce a
counter a player has already earned.

## Doc 26 scheduling

An event window must satisfy `ends_at > starts_at`. A window that ends before it
starts is refused, so there is no shape of window a client clock could exploit.

## Gate status

Typecheck, lint, 128 unit tests, production build, migration structure check
(41 functions), format check and bundle secret scan all pass.

pgTAP is now 119 assertions across eight files, all with matching plan counts.
Still unexecuted, blocked on Docker.

## Outstanding

- No Three.js 3D viewport. Doc 17's renderer is not built; the shell is a
  card-based authoritative HUD.
- No upgrade completion worker. `request_machine_upgrade` sets the machine to
  `UPGRADING` and records `completes_at`, but nothing advances it to completion
  and applies the new level. That needs a scheduled worker, which the outbox
  infrastructure could drive.
- No mission progress advancement. `claim_mission` reads progress, but nothing
  increments it from gameplay events yet. The objectives are data-driven and
  unused until then.
- No leaderboard read surface. The table exists and is authoritative; no UI or
  route reads it.
- No event window activation logic.
- pgTAP unexecuted; migrations unpushed by direction.
