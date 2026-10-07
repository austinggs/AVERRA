# 09 — WORLD NEWS AND EVENTS

## Event engine goals
Events should make markets feel alive and interconnected.

## Event categories
### Company
- earnings beat/miss
- new product
- product failure
- CEO resignation
- fraud investigation
- lawsuit
- acquisition
- bankruptcy risk
- supply shortage
- factory expansion
- data breach

### Macro
- inflation rise/fall
- interest-rate change
- recession warning
- employment report
- commodity shock
- currency crisis
- recovery

### Geopolitical
- trade agreement
- sanctions in the fictional world
- regional conflict
- diplomatic breakthrough
- election result

### Technology
- breakthrough
- major vulnerability
- AI boom
- semiconductor shortage
- battery breakthrough

### Market structure
- exchange outage
- liquidity crisis
- bubble
- flash crash
- short squeeze

## Event generation
Each event has:
- template
- trigger conditions
- probability
- severity
- affected assets/sectors
- market impact
- duration
- decay/half-life
- public news text

## News writing rules
- Never directly say "buy" or "sell".
- News can state facts and uncertainty.
- Headlines should be short.
- Details should expose relevant metrics so players can form their own thesis.

## Cascades
Events can trigger secondary effects.
Example:
1. Oil supply shock.
2. Energy prices rise.
3. Airlines costs increase.
4. Transport earnings weaken.
5. Inflation expectations rise.
6. Rate-sensitive stocks fall.

Use capped cascade depth so one event cannot recursively explode the economy.

## Scheduled vs random
- Scheduled macro events are deterministic.
- Random events use seeded server randomness.
- Event seeds must be stored for reproducibility in tests.
