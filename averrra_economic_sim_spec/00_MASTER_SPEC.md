# 00 — MASTER SPEC

## 1. Product name
Internal feature name: **AVERRA Economic Simulation**.
User-facing game can be branded later; implementation should avoid hard-coding a public name into domain identifiers.

## 2. Objective
Replace the existing mining simulator with a persistent virtual economy in which a player can build a simulated life and wealth through jobs, trading, investing, businesses, assets, fictional crypto, social commerce, and reactions to world events.

The product must be fun even when the user receives **zero real-world money**. Real rewards are a small, separate retention/promotional layer, not the core economic engine.

## 3. High-level domains
- Life: age, career, education, expenses, milestones.
- Economy: virtual NGN, inflation, interest, salaries, business activity.
- Markets: stocks, sectors, fictional crypto, commodities/future assets.
- Wallets: virtual NGN wallet and one wallet per fictional coin.
- Trading: market/limit orders, executions, holdings, P&L.
- Social market: player offers and custom trades.
- World: news, company events, macro events, geopolitical events.
- Competition: seasons, rankings, achievements.
- Store: paid game items/services.
- Real rewards: provisional earnings, qualification, actual AVERRA wallet; strictly separated.

## 4. Virtual money rules
Use an integer minor-unit representation for virtual NGN (`vNGN_minor`) even if the UI shows whole naira.
- 1 virtual NGN = 100 virtual kobo.
- Starting cash: 1,000,000 virtual NGN.
- Starting debt: 0.
- Starting crypto: 0.
- Virtual cash is never withdrawable.
- Virtual cash is never convertible into AVERRA real-money balance.
- No UI may imply that virtual cash is redeemable.

## 5. Launch assets
Initial V1 stock universe: 24 fictional public companies across 8 sectors.
Initial V1 crypto universe: 6 fictional coins.
Initial V1 commodity-like contracts are optional and OFF by default.

## 6. Server authority
Every state-changing action is server authoritative.
Client request is intent only:
- BUY/SELL
- SEND
- CREATE_TRADE
- ACCEPT_TRADE
- CANCEL_TRADE
- PLACE_LIMIT_ORDER
- CANCEL_ORDER
- BUY_STORE_ITEM
- SUBMIT_PAYMENT

Server computes and validates:
- current price
- quantity
- fees
- balance
- ownership
- execution
- P&L
- trade completion
- item fulfillment
- reward eligibility

## 7. Financial separation invariant
Never combine or sum these domains:
1. virtual game cash
2. fictional coin balances
3. provisional real earnings
4. withdrawable AVERRA wallet balance

Existing real-money objects such as `ledger_entries`, `rewards`, provider conversions, payout/outbox systems remain authoritative for real money.

## 8. Real-reward safety invariant
The game may display an estimated/provisional real reward, but:
- it is not a game balance;
- it cannot buy game items;
- it cannot buy crypto;
- it cannot be transferred peer-to-peer;
- it cannot be withdrawn until normal AVERRA financial qualification/settlement rules say so;
- it must never be presented as a guaranteed return on payment.

## 9. Manual payment invariant
V1 payment collection is manual.
No payment gateway is required.
All orders get unique IDs such as `AV-20261007-000184`.
Admin approval is the only bridge from pending payment to fulfillment.
Approval must be idempotent.

## 10. Fictional crypto invariant
Coin addresses are simulated identifiers only.
Example format: `avr1...` is an in-game address namespace, not a real blockchain address.
Never generate or store real private keys in V1.
Never accept real BTC/SOL/DOGE/USDT/etc. deposits.
Never advertise a fictional coin as a redeemable real cryptocurrency.

## 11. Default real-reward launch policy
Default configuration is intentionally tiny and configurable.
- Employment activation: ₦100 / 30 days (configurable before launch).
- Maximum provisional promotional reward: ₦200/user/month (configurable).
- No payout is guaranteed merely because the user paid the activation fee.
- Reward budgets are funded separately from store orders.
- Reward allocation must obey existing server-side reward funding and settlement controls.

The implementation must permit these values to be changed by admin configuration without a code deployment.

## 12. Definition of done
The replacement is complete only when:
- mining UI is removed/replaced from normal navigation;
- mining state no longer affects the new economy;
- all new state changes are server authoritative;
- all transfer/trade/payment/reward actions are idempotent;
- database constraints protect balances/ownership;
- tests cover happy paths, replay, race conditions, unauthorized calls, negative/overflow values, cross-user access, and economic invariants;
- virtual and real financial domains are demonstrably isolated.
