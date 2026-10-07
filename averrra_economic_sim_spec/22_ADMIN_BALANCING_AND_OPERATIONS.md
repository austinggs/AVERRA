# 22 — ADMIN, BALANCING AND OPERATIONS

## Admin dashboards
Provide controlled admin pages for:
- market state
- asset catalogue
- asset configuration
- event templates
- active events
- news
- store products
- store orders/manual payments
- seasons
- reward configuration
- economy telemetry
- flagged trades/transfers

## Configuration values
Store configurable parameters separately from code where practical:
- starting cash
- stock fees
- crypto fees
- marketplace fees
- tick caps
- volatility multipliers
- inflation range
- business costs
- reward caps
- employment activation price
- season duration

Changes should be audited.

## Economic controls
Admin may suspend:
- an asset
- a coin
- a market
- P2P transfers
- custom trades
- marketplace

Suspension affects new actions; historical records remain intact.

## Price engine controls
Admin can define scenarios:
- bull run
- recession
- crash
- recovery
- high inflation

A scenario must use an auditable configuration/seed.
Do not add an invisible admin-only price pump that changes users' results without an audit record.

## Monitoring
Track:
- tick processing duration
- failed jobs
- stale prices
- rejected orders
- suspicious transfer velocity
- game money supply growth
- inflation drift
- unexpected concentration of wealth
- reward exposure

## Safe intervention
If the economy becomes broken, prefer:
1. pause affected market
2. preserve current state
3. diagnose event/engine cause
4. apply a compensating game transaction
5. record admin audit event
6. resume

Never silently edit historical balances/positions.
