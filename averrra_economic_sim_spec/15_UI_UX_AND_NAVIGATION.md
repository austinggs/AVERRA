# 15 — UI/UX AND NAVIGATION

## Main navigation
Replace the current mining entry with:
- Home
- Markets
- Trade
- Wallets
- News
- Life
- Store
- More

On mobile, use the existing responsive navigation pattern from AVERRA's newer navigation work where possible.

## Home dashboard
Show:
- virtual cash
- total net worth
- daily P&L
- market status
- top movers
- latest news
- open trades/orders
- active job
- season rank
- estimated earnings card if eligible

## Markets
Tabs:
- Stocks
- Crypto
- Sectors
- Watchlist

Each asset card:
- symbol
- name
- current virtual price
- 24h change
- mini chart
- volatility/risk badge

## Asset detail
Show:
- chart
- current price
- daily/weekly/monthly change
- market cap where relevant
- company/coin description
- fundamentals
- recent news
- BUY / SELL
- Add to watchlist

## Trading terminal
Mobile-first but desktop rich.
- asset picker
- order type
- quantity
- estimated total
- fee
- execution estimate
- confirm button
- recent executions

## Wallets
Cards for:
- Virtual NGN
- each fictional coin

For fictional crypto show:
- simulated address
- balance
- value
- send
- receive
- transaction history

Add persistent disclaimer:
`Simulated game asset — not a real cryptocurrency.`

## Custom Trades
Screens:
- Create Offer
- Incoming Offers
- Sent Offers
- Trade History
- Marketplace

## News
Feed sorted by published_at.
Filters:
- My holdings
- Market
- Company
- Macro
- Crypto

## Life
Show:
- job
- salary
- age
- skills
- expenses
- net worth
- career progress

## Store
Clearly show:
- real-money price
- what the user gets
- whether item is virtual-only
- no guaranteed financial return language

## Payment status UX
States:
`Awaiting payment` → `Payment submitted` → `Under review` → `Approved` → `Fulfilled`.

## Provisional earnings
Use a separate visual section:
`Estimated earnings`
`Awaiting confirmation`
`Not withdrawable or spendable until AVERRA confirms it.`
Never render it in the same total as virtual net worth.
