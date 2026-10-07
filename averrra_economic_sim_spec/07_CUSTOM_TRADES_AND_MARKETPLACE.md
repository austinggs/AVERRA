# 07 — CUSTOM TRADES AND MARKETPLACE

## Purpose
Allow players to trade virtual assets directly with each other.

## Supported trade contents V1
- virtual cash
- fictional coins
- supported tradeable items
- selected vehicles
- selected property deeds
- selected collectibles

Do not support real AVERRA wallet balance.
Do not support real-money reward balance.

## Trade offer
A trade offer contains:
- proposer
- recipient/public target
- offered cash
- requested cash
- offered assets
- requested assets
- expiration
- status

Statuses:
- DRAFT
- OPEN
- ACCEPTED
- DECLINED
- CANCELLED
- EXPIRED
- FAILED

## Atomic acceptance
When accepted, the server must lock/check all assets and execute the full exchange atomically.
If any leg fails, the entire trade fails with no partial movement.

## Trade locking
An asset can have at most one active exclusive trade lock.
If the owner changes the asset before acceptance, related offer becomes invalid.

## Public marketplace
Users can post listings for supported items.
Listings can be:
- fixed price
- auction (future)

Marketplace fee: default 1% of sale value, paid by seller.

## Reputation
Each completed P2P trade can contribute to a non-monetary trader reputation score.
Inputs:
- completed trades
- cancelled trades
- confirmed disputes
- fraud flags
- account age
- rate of failed offers

Never make reputation itself withdrawable or tradable.

## Anti-scam UX
- Always show the complete exchange before confirmation.
- Show asset name, quantity, estimated value, and counterparty.
- Require explicit confirmation.
- Warn when value difference exceeds a configurable threshold, e.g. 50%.
- No irreversible transaction without confirmation.
