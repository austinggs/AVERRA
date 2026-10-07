# 17 — TEST PLAN

## Unit tests
### Market engine
- deterministic seeded output
- price floors
- max tick movement
- event decay
- sector correlation
- volatility classes
- no NaN/Infinity

### Trading math
- market buy
- market sell
- limit buy
- limit sell
- fees
- slippage
- realized P&L
- unrealized P&L
- average cost
- dividends

### Wallet math
- send
- fee
- insufficient balance
- self transfer blocked
- duplicate idempotency key
- exact amount handling

### Custom trades
- create
- cancel
- accept
- expired
- changed ownership invalidates
- insufficient funds
- atomic multi-leg settlement
- replay safety

### Store
- order creation
- duplicate order prevention
- manual payment submission
- approval
- rejection
- double approval
- fulfillment idempotency

### Real reward isolation
- provisional earnings never alter game cash
- game transfers cannot touch real ledger
- fictional coins cannot touch real ledger
- store approval cannot mint withdrawable real money directly unless an explicit existing approved reward path says so
- no provisional amount appears in wallet balance

## pgTAP / database tests
Cover:
- permissions
- row-level access
- constraints
- transaction atomicity
- replay
- race conditions
- cross-user access
- negative amounts
- oversized amounts
- inactive assets
- suspended markets
- admin-only functions

## Integration tests
- user opens market
- buys stock
- sees position
- receives news
- price changes
- sells stock
- realizes P&L
- generates fictional wallet
- sends coin to another player
- creates and accepts trade
- buys store item
- submits manual payment
- admin approves
- item fulfills once

## End-to-end tests
Desktop and mobile.
At minimum:
1. create new economic account
2. job salary arrives
3. stock buy/sell
4. crypto send
5. custom trade
6. store order/manual payment
7. provisional earnings separation
8. leaderboard
9. navigation replacing mining

## Security tests
Attempt to:
- edit price client-side
- change quantity after authorization
- overdraw account
- sell nonexistent shares
- accept someone else's trade
- approve payment as normal user
- reuse payment submission
- reuse fulfillment idempotency key
- call private RPC as public/anon
- spoof another user's wallet address ownership

## Acceptance target
No known P0/P1 financial or authorization defects.
All required DB suites green.
Typecheck, lint, build and production smoke tests green.
No secrets committed.
