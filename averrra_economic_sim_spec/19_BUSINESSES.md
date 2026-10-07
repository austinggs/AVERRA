# 19 — BUSINESSES

## Purpose
Let players turn virtual capital into operating businesses that generate revenue, expenses, profit and asset value.

## V1 business categories
- Food & Restaurant
- Retail Shop
- Logistics Company
- Software Agency
- Media/Content Studio
- Construction Company
- Small Manufacturing
- Online Marketplace Seller

## Purchase/startup
Each business has:
- startup_cost
- working_capital_requirement
- base_revenue
- gross_margin
- operating_cost
- employee capacity
- growth potential
- risk class
- sector
- location modifier

Example startup costs:
- small shop: ₦5M virtual
- restaurant: ₦8M
- agency: ₦3M
- logistics: ₦15M
- manufacturing: ₦50M

These are game values, not real-money prices.

## Operating cycle
Businesses recalculate once per simulated day.
Revenue is based on:
`base_demand * location_factor * reputation_factor * economy_factor * competition_factor * event_factor`

Profit:
`gross_revenue - cost_of_goods - payroll - rent - utilities - taxes - maintenance - fees`

## Reputation
Business reputation ranges from 0–100.
Affected by:
- profitability
- customer events
- product quality
- owner decisions
- scandals
- outages
- marketing

## Expansion
At configured thresholds players can:
- hire workers
- open additional locations
- upgrade equipment
- increase inventory
- launch products
- borrow virtual money

## Business ownership
V1 business is 100% owned by one player.
Future versions may support fractional fictional ownership and IPOs.

## Bankruptcy
If a business cannot meet required cash obligations, it enters WARNING.
After a configurable number of simulated days it can enter INSOLVENT.
Assets are liquidated according to the business liquidation rules.
Player's personal virtual wallet is not automatically seized in V1 unless a future loan/collateral feature explicitly allows it.

## News connection
Business events can feed into the global news system:
- record sales
- expansion
- product failure
- scandal
- acquisition
- bankruptcy
