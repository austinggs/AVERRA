AVERRA — GAME ECONOMY FLOW

Document: 75_GAME_ECONOMY_FLOW.md
Version: 1.2
Status: Approved planning baseline
Last reviewed: 2026-09-30

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
