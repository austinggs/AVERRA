# AVERRA Economic Simulation — Cline Build Specification

This package defines the replacement for AVERRA's current mining simulator.

The target is a persistent, server-authoritative **virtual economic life simulation** containing trading, fictional cryptocurrency, jobs/wages, businesses, assets, news, events, player-to-player trade, virtual wallets, seasons, leaderboards, and a small isolated real-money promotional reward layer.

## Read order
1. `00_MASTER_SPEC.md`
2. `01_PRODUCT_AND_DESIGN.md`
3. `02_GAME_ECONOMY.md`
4. `03_MARKETS_AND_PRICE_ENGINE.md`
5. `04_STOCK_MARKET.md`
6. `05_FICTIONAL_CRYPTO.md`
7. `06_PLAYER_WALLETS_AND_TRANSFERS.md`
8. `07_CUSTOM_TRADES_AND_MARKETPLACE.md`
9. `08_JOBS_WAGES_AND_LIFE.md`
10. `09_WORLD_NEWS_EVENTS.md`
11. `10_MONETIZATION_AND_MANUAL_PAYMENTS.md`
12. `11_REAL_REWARD_LAYER.md`
13. `12_SECURITY_ANTI_FRAUD.md`
14. `13_DATABASE_AND_BACKEND.md`
15. `14_API_AND_SERVER_ACTIONS.md`
16. `15_UI_UX_AND_NAVIGATION.md`
17. `16_MIGRATION_FROM_MINING.md`
18. `17_TEST_PLAN.md`
19. `18_BUILD_ORDER.md`

## Critical constraints
- All game balances are virtual and have no cash value.
- All fictional coins are simulated database assets. No blockchain, private keys, real crypto deposits, or crypto withdrawals in V1.
- Real AVERRA wallet balances remain a separate financial domain.
- Provisional real earnings are never counted as game cash, game crypto, portfolio value, or withdrawable balance.
- The client never decides money, inventory, trade, price, reward, or ownership outcomes.
- Never bypass payment-provider age/KYC requirements.
- V1 store payments are manually verified; fulfillment is automatic after admin approval.
- Do not delete or mutate existing AVERRA financial/referral/provider settlement invariants merely to implement the game.
