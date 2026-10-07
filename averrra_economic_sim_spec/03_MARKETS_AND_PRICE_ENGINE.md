# 03 — MARKETS AND PRICE ENGINE

## Price tick
Default simulation tick: 60 seconds.
Prices can be recalculated at tick boundaries; clients receive updates through realtime/polling without recalculating locally.

## Generic return model
For each asset and tick, compute a server-side return:

`r = market_factor*beta + sector_factor*sector_beta + fundamental_drift + sentiment_factor + event_shock + liquidity_noise`

Then:
`new_price = max(min_price, previous_price * (1 + clamp(r, -max_tick_move, +max_tick_move)))`

Suggested defaults:
- Stocks max tick move: 5%.
- Crypto max tick move: 10%.
- Blue-chip volatility multiplier: 0.5.
- Growth volatility multiplier: 1.0.
- Speculative multiplier: 1.8.

## Mean-reversion safeguard
Do not allow an asset to move infinitely based on one event.
Event shocks decay exponentially:
`impact_t = impact_0 * e^(-t/half_life)`.

## Market states
Global states:
- BULL
- NORMAL
- BEAR
- RECESSION
- PANIC
- RECOVERY

Each state changes:
- market drift
- volatility
- sector bias
- liquidity
- frequency/severity of bad news

## Sector states
Each sector receives a separate latent trend from -1.0 to +1.0.
Sector trend mean-reverts slowly.

## Company fundamentals
Every company has:
- revenue
- profit
- debt
- cash
- employees
- market share
- growth rate
- margins
- dividend policy
- valuation multiple
- volatility class
- liquidity class
- reputation
- financial health

## Fundamental update cadence
Fundamentals update daily/weekly, not every minute.
Examples:
- revenue growth
- cost changes
- debt changes
- earnings releases
- employee changes
- market-share changes

## News and events influence
Every event has:
- type
- issuer/target
- severity
- start time
- duration
- direct factor
- affected sectors
- affected macro state
- public/private flag

Public news becomes visible to everyone at the same simulation time.

## Market manipulation prevention
V1 players do not directly control global asset prices.
Player trading volume can influence liquidity/price only through future V2 order-book simulation, after strict anti-manipulation controls exist.

## Historical candles
Persist aggregated candles for:
- 1 minute: rolling 7 days
- 5 minute: rolling 30 days
- 1 hour: rolling 180 days
- 1 day: persistent season history
This can be implemented via scheduled aggregation jobs to avoid storing unnecessary tick rows forever.
