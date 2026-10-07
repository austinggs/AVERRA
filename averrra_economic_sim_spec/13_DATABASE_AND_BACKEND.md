# 13 — DATABASE AND BACKEND

## Schema namespace
Prefer `app` schema for private server-side domain tables and expose only controlled `public` RPCs/API views where required by the existing AVERRA architecture.

## Core tables
Suggested tables:

### `app.game_accounts`
- user_id PK
- virtual_cash_minor
- created_at
- updated_at
- status

### `app.trading_assets`
- asset_id
- type (`STOCK`, `CRYPTO`, later `COMMODITY`, `BOND`)
- symbol
- name
- status
- quote_currency
- fictional_only boolean default true

### `app.trading_companies`
- company_id
- asset_id
- sector
- revenue_minor
- profit_minor
- debt_minor
- cash_minor
- employees
- market_share_bps
- growth_bps
- margin_bps
- dividend_policy
- reputation_score
- financial_health_score
- volatility_class
- liquidity_class

### `app.trading_market_state`
- market_date/time
- global_state
- market_index
- volatility_index
- inflation_index
- seeded_random_state

### `app.trading_prices`
- asset_id
- timestamp
- open_minor
- high_minor
- low_minor
- close_minor
- volume

### `app.trading_orders`
- order_id
- user_id
- asset_id
- side
- type
- quantity
- limit_price_minor nullable
- status
- idempotency_key
- created_at
- cancelled_at

### `app.trading_executions`
- execution_id
- order_id
- user_id
- asset_id
- quantity
- price_minor
- fee_minor
- executed_at

### `app.trading_positions`
- user_id
- asset_id
- quantity
- avg_cost_minor
- realized_pnl_minor
- updated_at

### `app.trading_accounts`
- user_id
- season_id
- cash_minor
- realized_pnl_minor
- total_fees_minor
- status

### `app.virtual_wallets`
- wallet_id
- user_id
- asset_type
- asset_id nullable
- address
- status

### `app.virtual_wallet_transactions`
- tx_id
- asset_type
- asset_id
- from_user_id nullable
- to_user_id nullable
- amount_minor
- fee_minor
- status
- idempotency_key
- created_at

### `app.trading_events`
- event_id
- type
- severity
- target_asset_id nullable
- target_sector nullable
- market_impact
- duration
- seed
- status

### `app.trading_news`
- news_id
- event_id
- headline
- body
- published_at
- sentiment_label

### `app.game_seasons`
- season_id
- name
- starts_at
- ends_at
- starting_cash_minor
- status

### `app.game_leaderboards`
- season_id
- user_id
- metric
- score
- rank

### `app.game_achievements`
- achievement_id
- code
- name
- criteria_json

### `app.user_achievements`
- user_id
- achievement_id
- earned_at

### `app.store_orders`
- order_id
- user_id
- amount_minor
- currency
- status
- idempotency_key
- created_at

### `app.store_order_items`
- order_id
- product_id
- quantity
- unit_price_minor

### `app.manual_payment_submissions`
- submission_id
- order_id
- user_id
- provider_label
- transaction_reference
- claimed_amount_minor
- evidence_pointer nullable
- status
- reviewed_by
- reviewed_at
- reviewer_note

### `app.store_fulfillments`
- fulfillment_id
- order_id
- item_type
- item_payload
- idempotency_key
- status

## Constraints
Use database constraints for:
- nonnegative quantities/balances
- valid sides/statuses
- unique addresses
- unique idempotency keys per logical scope
- unique active position row per user/asset

## RPC/server function patterns
Use transactional functions such as:
- `create_game_account`
- `deposit_virtual_cash` (system only)
- `place_trading_order`
- `cancel_trading_order`
- `execute_market_order`
- `match_limit_orders`
- `send_virtual_asset`
- `create_custom_trade`
- `accept_custom_trade`
- `decline_custom_trade`
- `cancel_custom_trade`
- `create_store_order`
- `submit_manual_payment`
- `approve_manual_payment`
- `reject_manual_payment`
- `get_game_wallet_summary`
- `get_portfolio_summary`
- `get_market_snapshot`
- `get_provisional_earnings`

## Important implementation instruction
Do not assume these exact table names already exist. Before migration, Cline must inspect the existing repository and current mining simulator and reconcile names, migrations, routes, types, and permissions.
