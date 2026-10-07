# 02 — GAME ECONOMY

## Base currency
Name: Virtual NGN.
Internal code: `VNGN`.
Display example: `₦12,450,000` with a small `VIRTUAL` badge whenever ambiguity is possible.

## Starting profile
- Starting virtual cash: ₦1,000,000.
- Age: 18 for the economic game at account creation unless AVERRA's broader life system supplies another age.
- First job: Unemployed.
- Stocks: 0.
- Crypto: 0.
- Properties: 0.
- Businesses: 0.
- Debt: 0.

## Sources of virtual money
1. Job wages.
2. Business profits.
3. Dividends.
4. Trading profits.
5. Asset sales.
6. Game events.
7. Awards/achievements.

## Sinks
1. Food and daily living expenses.
2. Housing/rent.
3. Transport.
4. Taxes.
5. Business expenses.
6. Trading fees.
7. Crypto network fees.
8. Marketplace fees.
9. Loans/interest.
10. Asset maintenance.

## Inflation
V1 uses a global simulated inflation index.
- Base index = 100.
- Monthly target drift = 0.3% to 1.2% depending on macro state.
- Inflation influences salaries, consumer goods, rents and company fundamentals slowly.
- Do not directly multiply stock prices by CPI; prices react through the market engine.

## Net worth
`net_worth = virtual_cash + marked_to_market_assets + business_equity + property_value - liabilities`

Market values use current server prices.
Personal-use assets can have depreciation.

## Bankruptcy floor
A player cannot have virtual cash below `0` after a normal transaction.
If expenses exceed cash, allowed options are:
- draw an approved loan;
- sell eligible assets;
- reduce expenses;
- declare simulated insolvency if that future mechanic is enabled.
V1 should not force a negative wallet.

## Economy telemetry
Store daily aggregates:
- money supply
- average player cash
- median player cash
- top 1% wealth
- CPI/inflation index
- unemployment rate
- market index
- crypto aggregate market cap
This data supports balancing and world news.
