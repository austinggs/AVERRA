AVERRA — ECONOMIC SIMULATION (AUTHORITATIVE)

Document: 88_ECONOMIC_SIMULATION.md
Version: 1.0
Status: Approved planning baseline
Supersedes: 15-34 (Mining Game) — superseded 2026-10-07 by CR-0035
Last reviewed: 2026-10-07

PURPOSE

Defines the authoritative economic-simulation roadmap that replaces the Mining Game
as AVERRA's intended primary game surface, and defines the mandatory retirement path
for the Mining Game. This document is the single authoritative source for the
three-layer economic separation, the V1 market simulation, and the change-record
sequence.

This document is a PLAN. It creates no code, no table, no migration, no endpoint,
no feature flag and no UI. It changes nothing that is running in production.

NORMATIVE LANGUAGE

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY
are used as engineering requirements.

---------------------------------------------------------------------------
1. AUTHORITY AND SCOPE
---------------------------------------------------------------------------

- This document and 89_NUMERIC_AND_MONEY_REPRESENTATION.md are authoritative for
  economic simulation.
- Documents 15-34 (Mining Game) are SUPERSEDED. Their content is retained verbatim
  as history and MUST NOT be used as an implementation requirement.
- Documents 48_DATABASE_SCHEMA.txt and 49_API_SPECIFICATION.txt remain authoritative
  for REAL MONEY. This document does not modify them except where it explicitly
  cross-references them.
- The external package averrra_economic_sim_spec/ is INPUT, not baseline. Where it
  conflicts with this document or 89, this document wins. Its conflicts are recorded
  in docs/DISCREPANCIES.md (Q-48 onward).

---------------------------------------------------------------------------
2. THE THREE-LAYER ECONOMIC SEPARATION (NON-NEGOTIABLE)
---------------------------------------------------------------------------

There are three economic layers. They are separate domains. They MUST NOT be
combined, summed, netted, or presented as one figure.

LAYER 1 — VIRTUAL GAME ECONOMY (no real-world value)
  Virtual cash, fictional coin balances, positions, property, business equity,
  P&L, net worth. Virtual cash is NEVER withdrawable and is NEVER convertible into
  AVERRA real-money balance. No UI may imply that virtual cash is redeemable.
  Layer 1 MUST NOT contain a real ledger entry.

LAYER 2 — PROVISIONAL REAL-MONEY EARNINGS (read-only projection)
  A read-only projection of estimated earnings. NOT withdrawable. NOT spendable.
  NOT transferable peer-to-peer. NOT able to buy game items or fictional crypto.
  No table, no ledger entry, no reward row, no payout. Layer 2 is a view over
  existing authoritative records, exactly as delivered by CR-0034b (migration 064,
  provisional_provider_earnings). It MUST NOT become money.
  The public payload MUST NOT contain a field named payable, confirmed or settled.

LAYER 3 — GOVERNED REAL-MONEY REWARDS (authoritative, existing)
  The existing AVERRA financial system: ledger_entries, rewards, funding sources,
  settlement, outbox, payout. Layer 3 is the ONLY domain in which real money moves.
  Layer 3 MUST NOT be derived from Layer 1 profits, virtual net worth, virtual
  asset appreciation, or the amount a user paid.

THE PROHIBITION THAT MATTERS MOST

  Layer 3 MUST NOT be computed as `virtual_profit * rate = real money`.

Real rewards derive only from independent qualifying activities and campaigns, under
the existing server-side reward funding and settlement controls.

DISPLAY RULE

A virtual amount and a Layer 2 estimate MUST NEVER be rendered inside the same
total. Layer 1 amounts MUST carry an explicit virtual marker wherever ambiguity is
possible. This mirrors the existing MoneyState / --color-gamify-* separation in the
AVERRA design system.

---------------------------------------------------------------------------
3. WHAT THIS DOCUMENT DOES NOT CHANGE
---------------------------------------------------------------------------

Nothing in the governed real-money path is altered, weakened, or reinterpreted:

- CR-0028 risk gate on the reward engine (grant_reward / grant_reward_ungated)
- CR-0032 append-only provider reversals (a reversal is a NEW conversion row)
- CR-0033 settlement gate (AVAILABLE is unreachable except via a MATCHED settlement)
- CR-0017 funding-spend polarity (a funding SPEND is a USER_FUNDING_SPEND DEBIT)
- CR-0013 the bounded public wrapper surface (no direct .from() on an app table)

This document MUST NOT be read as authority to relax any of them.

---------------------------------------------------------------------------
4. MARKET SIMULATION — V1
---------------------------------------------------------------------------

V1 uses a DETERMINISTIC, LAZY-ON-READ simulation. There is NO scheduler.

- No cron job, no pg_cron, no background worker, no price-writing job.
  The repository contains no scheduler and none is introduced.
- A price is computed when it is READ, from (canonical epoch, seed, asset, tick).
- The canonical epoch is fixed. A tick index is derived deterministically from the
  canonical epoch, never from wall-clock "now" at read time.
- Identical inputs MUST yield an identical price on any server, in any session, at
  any time, forever. Two readers at the same tick MUST see the same price.
- Client code MUST NOT recompute any price. The client renders server values only.
- Arithmetic MUST be PostgreSQL numeric, with exactly one final rounding step.
  See 89_NUMERIC_AND_MONEY_REPRESENTATION.md.

The intent is that market movement is a pure function of simulation position, so it
is reproducible in tests and identical across replicas, without an infrastructure
component that does not exist.

---------------------------------------------------------------------------
5. FICTIONAL CRYPTO
---------------------------------------------------------------------------

- Coin "addresses" are virtual identifiers in an in-game namespace ONLY.
- V1 has NO blockchain custody, NO keys, NO signing, NO on-chain settlement, and NO
  off-platform transfer capability.
- Fictional coins MUST NEVER be described or presented as a redeemable real
  cryptocurrency. A persistent disclaimer is required wherever they appear.
- No real BTC/SOL/DOGE/USDT or any real token deposit is accepted anywhere in
  Layer 1.

---------------------------------------------------------------------------
6. STORE AND MONETIZATION — GENERALIZE, DO NOT DUPLICATE
---------------------------------------------------------------------------

CR-0042 generalizes the EXISTING paid-perks / funding-spend system (CR-0017).

There MUST NOT be a second store, a second order table, or a second payment-order
architecture. The new game store is an extension of the existing paid-perk order,
product, entitlement and manual-payment-submission machinery.

---------------------------------------------------------------------------
7. MINING RETIREMENT — DORMANT, NOT REMOVED
---------------------------------------------------------------------------

The Mining Game is DORMANT: still present, still reachable, still holding player
data and referenced by the real ledger. Retirement proceeds in four ordered stages:

  STAGE 1  dormant
           Plan only. Mining stays exactly as it is. No production change.
  STAGE 2  dependencies re-pointed
           Navigation and any dependency is re-pointed away from mining, and
           production absence of mining is demonstrated.
  STAGE 3  production absence verified
           Mining is proven absent from production paths in a deployed
           environment, with evidence, not by inspection of the source tree.
  STAGE 4  final retirement
           Destructive removal only.

RULES

- CR-0045 is the ONLY destructive retirement change record.
- No earlier CR may drop, truncate, archive or rewrite mining data.
- The existing mining-data audit remains a hard prerequisite to Stage 4.
- Mining is not deleted because it is old. It is deleted only after its absence
  from production is proven and its data has been audited.

---------------------------------------------------------------------------
8. CHANGE-RECORD SEQUENCE
---------------------------------------------------------------------------

  CR-0035  This document. Documentation-only baseline amendment. No code.
  CR-0036  Mining-data audit and dependency inventory. Read-only.
  CR-0037  Economic-simulation domain foundation (game account, virtual cash).
  CR-0038  Asset catalogue, seasons, game audit events.
  CR-0039  Market engine (deterministic lazy-on-read prices, market states).
  CR-0040  Trading (market orders, positions, P&L, fees).
  CR-0041  Fictional crypto (virtual wallets, identifiers, transfers).
  CR-0042  Store and manual payments, GENERALIZING CR-0017. No second store.
  CR-0043  Jobs, wages, life, expenses.
  CR-0044  Navigation re-point, estimated-earnings surface, custom trades.
  CR-0045  Final mining retirement. The ONLY destructive CR.

Every CR MUST record its own change record per 81_CHANGE_MANAGEMENT.md.

---------------------------------------------------------------------------
9. KNOWN COLLISIONS — RESOLVE BEFORE IMPLEMENTING
---------------------------------------------------------------------------

These are recorded here so they are not rediscovered mid-build.

a) app.game_achievements ALREADY EXISTS in the mining schema
   (migration 20260930000021, line 79). The external spec proposes creating a table
   of the same name. That is a hard collision against a live schema and MUST be
   renamed before any implementation migration.

b) The external spec defines an order state PAID. The live enum
   app.paid_order_status is PENDING, CONFIRMED, FULFILLED, REFUNDED, CANCELLED.
   There is no PAID. Writing PAID would repeat the CR-0029 defect class, where a
   presentation literal did not exist in the enum and paid money rendered as unpaid.
   Read the enum before writing any display or state mapping.

c) The external spec names a mint path deposit_virtual_cash. "Deposit" in this
   repository means real user funding. A virtual mint MUST NOT be named deposit.

d) The external spec names price columns with a _minor suffix while also requiring
   fractional numeric prices. These conflict. See 89, section 4.

---------------------------------------------------------------------------
10. WHAT THIS DOCUMENT DOES NOT AUTHORIZE
---------------------------------------------------------------------------

This document authorizes NO change to: code, migrations, database schema,
application code, tests, configuration, feature flags, UI, API routes, or mining
data. CR-0035 is documentation-only. Implementation begins at CR-0036.