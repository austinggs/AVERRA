AVERRA — GAME ECONOMY FLOW

Document: 75_GAME_ECONOMY_FLOW.md
Version: 1.3
Status: Approved planning baseline
Last reviewed: 2026-10-07

AMENDMENT CR-0035 (2026-10-07)
- 88_ECONOMIC_SIMULATION.md and 89_NUMERIC_AND_MONEY_REPRESENTATION.md are added
  as the authoritative requirement for economic simulation.
- Documents 15-34 (Mining Game) are SUPERSEDED and retained verbatim as history.
- Mining is DORMANT: still in production, still holding player data. Nothing may
  drop, archive or rewrite mining data before CR-0045.
- The mining economy flow described here is superseded by the three-layer flow in
  88 section 2: Layer 1 virtual game economy, Layer 2 provisional real-money
  earnings (read-only, not withdrawable, not spendable), Layer 3 governed
  real-money rewards (the only domain in which real money moves).
- This CR changed documentation only. No code, schema, migration, test,
  configuration, feature flag, UI or API was changed.

PURPOSE
Explains the virtual mining economy and the controlled bridge from confirmed user funding into game purchases.

CORE FLOW
Energy → machine action → raw resource → processing → inventory → upgrade/expansion → mission/event/achievement → XP/leaderboard.

USER FUNDING INTEGRATION
Confirmed User Funding Balance may purchase explicitly supported Mining Game items/services. The purchase command verifies available funding, creates a USER_FUNDING_SPEND ledger event, then grants the matching game entitlement/resource.

ISOLATION
User funding is monetary/accounting state. Game resources are virtual/non-monetary state. Spending money on a game item does not create an equal withdrawal entitlement, and game resources do not automatically return monetary value.

REFUND / REVERSAL
Game-purchase refunds or entitlement revocation are separate service events and must not rewrite unrelated earned reward history.

FINANCIAL BRIDGE
Only explicit promotional rules can create money rewards: authoritative qualifying event → fraud gate → Reward Engine → earned-reward ledger.
