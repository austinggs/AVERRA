# 16 — MIGRATION FROM THE CURRENT MINING SIMULATOR

## Goal
Replace the current mining simulator cleanly without damaging unrelated AVERRA functionality.

## Mandatory first step for Cline
Inspect the current repository before changing production code.
Map:
- mining routes/pages
- mining components
- navigation entries
- DB tables
- RPC/functions
- scheduled jobs
- cron/worker calls
- rewards/balance integrations
- API routes
- tests
- analytics
- feature flags
- type definitions

Do not assume any existing name.

## Replacement strategy
Prefer a controlled feature replacement rather than a blind delete.
1. Identify the existing mining feature boundary.
2. Introduce the new economic-game domain in isolated modules.
3. Route existing mining navigation to the new game shell once the shell is functional.
4. Remove mining-only mutation paths from user-accessible UI.
5. Disable mining jobs/workers after proving nothing else depends on them.
6. Preserve historical financial/audit data unless it is strictly mining-only and safe to archive.

## Mining balance cleanup
Any old mining-specific balance must NOT become real money.
Choose one of:
- convert to a one-time virtual starting grant only if explicitly approved;
- migrate to a clearly labeled legacy virtual balance;
- retire it and keep a historical record.

Never convert old mining balances into AVERRA withdrawable money.

## Database migration rules
- Never drop a table before dependency analysis.
- Do not change real reward/ledger tables as a shortcut.
- Revoke obsolete EXECUTE privileges from retired mining functions where appropriate.
- Ensure Data API exposure remains minimal.
- Add pgTAP coverage for authorization and financial isolation.

## Rollback
Use a feature flag during rollout:
`GAME_ECONOMIC_SIM_ENABLED`

Recommended states:
- false: old mining UI still visible for internal fallback only
- true: new game active

Once stable, remove legacy mining UI and migration-only code in a later cleanup change.

## Important
The new game must not depend on mining timers, mining claims, mining hash calculations, or mining reward generation.
