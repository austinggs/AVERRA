# 05 — FICTIONAL CRYPTO

## Important
These coins are **not real cryptocurrencies**.
They are simulated assets stored in AVERRA's database.
No real blockchain interaction exists in V1.

## Initial coins
1. AVR — Averra — initial price ₦50 — supply 10,000,000,000 — utility/core ecosystem.
2. NOVA — NovaNet — initial price ₦20 — supply 5,000,000,000 — technology/growth.
3. LUX — Luxor — initial price ₦100 — supply 2,000,000,000 — premium/finance.
4. PULSE — Pulse — initial price ₦5 — supply 25,000,000,000 — high-frequency/high-volatility.
5. KITE — Kite — initial price ₦1 — supply 50,000,000,000 — meme/speculative.
6. VOLT — Volt — initial price ₦250 — supply 1,000,000,000 — energy/industrial.

## Coin properties
Each coin has:
- symbol
- name
- total supply
- circulating supply
- max supply
- market price
- volatility class
- liquidity class
- utility narrative
- reputation
- network health
- creator/foundation narrative
- event sensitivity

## Wallet address generation
When a user first creates a wallet for a coin, generate a random 32-byte identifier and encode with a clear fictional prefix.
Example display:
`avr1q7x9p3...8k2m`

This is an internal address identifier only.
It is not a blockchain address and must never be accepted by a real wallet.

## Internal transfers
Player A can send coin X to player B using B's in-game address.
Server validates:
- sender owns enough balance
- destination exists
- coin exists
- amount > 0
- sender != destination unless a permitted system action
- account restrictions

Network fee: default 0.10% with minimum 0.01 coin, configurable per coin.
Fee is burned or paid to a simulated network treasury; choose burn for V1 simplicity.

## Crypto trading pairs
Default:
- AVR/VNGN
- NOVA/VNGN
- LUX/VNGN
- PULSE/VNGN
- KITE/VNGN
- VOLT/VNGN
and selected crypto/crypto pairs later.

## Crypto price behavior
Crypto is 24/7.
Use wider volatility than stocks.
Sentiment and global risk state have stronger weight.

## Crypto events
Examples:
- exchange outage
- protocol upgrade
- token burn
- whale transfer rumor
- developer resignation
- exploit
- regulatory rumor inside the fictional world
- major partnership
- ecosystem growth
- network congestion
- validator failure
- hard fork

These events affect price but do not create real tokens.

## Future V2/V3
Possible simulated mechanics:
- staking
- validator selection
- mining facilities
- liquidity pools
- AMM-style swaps
- governance
- token burns
- forks

Do not implement real on-chain settlement in V1.
