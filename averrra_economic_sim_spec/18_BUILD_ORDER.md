# 18 — BUILD ORDER FOR CLINE

## Phase 0 — Repository reconnaissance
Do not modify production code until you map the current mining simulator and related financial dependencies.
Deliver a short dependency map and identify exact files/functions to replace.

## Phase 1 — Domain foundation
Implement:
- game account
- virtual cash
- asset catalogue
- seasons
- server-authoritative transactions
- audit events

No real-money changes.

## Phase 2 — Market engine
Implement:
- asset prices
- seeded simulation
- market states
- sectors
- company fundamentals
- candles
- news/event engine

Run the engine deterministically in tests before enabling background jobs.

## Phase 3 — Trading
Implement:
- market orders
- positions
- P&L
- fees/slippage
- limit orders behind a feature flag if necessary

## Phase 4 — Fictional crypto
Implement:
- six fictional coins
- simulated addresses
- wallet balances
- sends/receives
- virtual network fees
- crypto market pricing

No real blockchain integrations.

## Phase 5 — Custom trades
Implement:
- peer offers
- atomic acceptance
- marketplace
- trade history
- reputation

## Phase 6 — Life/economy
Implement:
- jobs
- virtual salary
- expenses
- skills
- simple career progression

## Phase 7 — Store + manual payments
Implement:
- catalogue
- orders
- payment submission
- admin verification
- automatic fulfillment
- refunds/compensating actions
- future payment-provider abstraction

## Phase 8 — Real provisional reward bridge
Implement only after the above is stable:
- active participation entitlement
- provisional reward display
- strict separation from game wallets
- use existing AVERRA financial controls

Do not weaken settlement gates or funding checks.

## Phase 9 — Replace mining UI
- new navigation
- game home
- markets
- wallet
- trade
- news
- life
- store
- estimated earnings
- remove/disable mining entry

## Phase 10 — Rollout
- feature flag
- internal users
- seed data
- smoke tests
- observe logs
- then full rollout

## Cline coding rules
- Inspect existing conventions before adding new patterns.
- Prefer existing AVERRA utilities, auth and RPC patterns.
- Do not duplicate financial logic that already exists.
- Do not put secrets in source code.
- Do not directly expose private tables through Data API unless the existing architecture requires it and RLS is correct.
- Every migration must be reversible or have a documented safe rollback strategy.
- Every new state-changing function must have authorization tests.
- Every financial mutation must be transactionally safe and idempotent.
- Keep fictional and real-money domains physically distinct in code and schema.
- Do not invent real provider behavior.
- Do not turn fictional crypto into actual crypto.
- Do not remove existing AVERRA reward/settlement gates to make the game easier to test.
