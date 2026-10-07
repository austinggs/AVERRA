# 14 — API AND SERVER ACTIONS

## Public/read endpoints
Exact route naming should match AVERRA conventions, but the API surface should support:
- market snapshot
- asset detail
- price candles
- portfolio
- wallet summary
- wallet transactions
- open orders
- trade offers
- marketplace listings
- news feed
- current events
- seasons/leaderboards
- achievements
- store catalogue
- own store orders
- provisional earnings

## Mutating actions
### Trading
`POST /api/game/trading/orders`
Input: asset_id, side, type, quantity, optional limit price, idempotency key.
Server returns order/execution status.

### Cancel
`POST /api/game/trading/orders/:id/cancel`

### Virtual transfer
`POST /api/game/wallet/send`
Input: asset, destination address, amount, idempotency key.

### Custom trade
`POST /api/game/trades`
`POST /api/game/trades/:id/accept`
`POST /api/game/trades/:id/decline`
`POST /api/game/trades/:id/cancel`

### Store order
`POST /api/store/orders`

### Manual payment submission
`POST /api/store/orders/:id/payment-submission`

### Admin approval
`POST /api/admin/store/orders/:id/approve-payment`

### Admin rejection
`POST /api/admin/store/orders/:id/reject-payment`

## Responses
Never return raw DB errors to clients.
Return stable application codes such as:
- `INSUFFICIENT_FUNDS`
- `INSUFFICIENT_POSITION`
- `ORDER_NOT_OPEN`
- `TRADE_NOT_VALID`
- `ADDRESS_NOT_FOUND`
- `DUPLICATE_REQUEST`
- `PAYMENT_ALREADY_REVIEWED`
- `FULFILLMENT_ALREADY_APPLIED`

## Realtime
Market prices/news can be pushed through existing AVERRA realtime infrastructure.
State mutations remain server/database authoritative.

## Caching
Read-only market snapshots may be cached briefly.
Never cache personalized balance authorization decisions in a shared cache.
