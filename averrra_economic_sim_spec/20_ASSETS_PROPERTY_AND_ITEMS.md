# 20 — ASSETS, PROPERTY AND ITEMS

## Purpose
Give virtual wealth tangible form and create items that can be traded between players.

## V1 asset categories
- Vehicles
- Residential property
- Commercial property
- Collectibles
- Business equipment
- Cosmetic game items

## Vehicle model
Each vehicle has:
- purchase price
- age
- condition
- maintenance cost
- depreciation rate
- tradeable flag

Example fictional/ordinary categories:
- compact car
- sedan
- SUV
- sports car
- luxury car
- motorcycle

## Property model
Each property has:
- property type
- location
- size
- base market value
- rent potential
- maintenance
- appreciation rate
- occupancy
- tradeable flag

Example:
- studio apartment
- family apartment
- townhouse
- office
- retail unit
- warehouse

## Property pricing
Base value changes daily using:
`base_trend + local_demand + inflation + interest_rate + neighborhood_event + supply_factor`

## Collectibles
Collectibles have scarcity tiers:
- COMMON
- UNCOMMON
- RARE
- EPIC
- LEGENDARY

Collectibles can be traded but have no guaranteed value.

## Item ownership
An item has exactly one current owner unless the future fractional-ownership system explicitly supports otherwise.

## Item trade safety
Tradeable status is immutable during an open trade or requires invalidating all affected offers.

## No real-world redemption
Physical-looking items are still virtual.
A game item cannot be exchanged for actual money outside the separate AVERRA store/reward systems.
