AVERRA — ECONOMIC SIMULATION (AUTHORITATIVE)

Document: 88_ECONOMIC_SIMULATION.md
Version: 1.1
Status: Approved planning baseline
Supersedes: 15-34 (Mining Game) — superseded 2026-10-07 by CR-0035
Last reviewed: 2026-10-07

AMENDMENT CR-0035A (2026-10-07) - SEQUENCE CORRECTION ONLY
- Approved CR-0035 baseline: commit 13456ec5ada5df652f6b4f40c6c77cbd3de5bbec.
- Sections 1-5, 9 and 10 are UNCHANGED. No substantive CR-0035 design was altered.
- Section 8, CHANGE-RECORD SEQUENCE, is corrected per explicit owner instruction.
  Sections 6 and 7 are updated ONLY where they name a CR number that the section 8
  reorder moved, so the document stays internally consistent.
- The substantive difference is CR-0042 and CR-0044. The store moves from CR-0042
  to CR-0044; player-to-player trades and the marketplace move from CR-0044 to
  CR-0042. The reason is recorded in section 8, at the end.
- CR-0036 remains the FIRST step and remains strictly read-only.

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

CR-0044 generalizes the EXISTING paid-perks / funding-spend system (CR-0017).

There MUST NOT be a second store, a second order table, or a second payment-order
architecture. The new game store is an extension of the existing paid-perk order,
product, entitlement and manual-payment-submission machinery.

The store is sequenced at CR-0044, behind the whole virtual economy. It is the
highest-risk surface in this roadmap because it is the only one that touches the
real-money order machinery, and it is therefore last among the virtual-economy
change records. See section 8 for the reason the store was moved here.

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

CR-0045 is the ONLY destructive retirement change record. Every one of the
following MUST hold before CR-0045 may begin:

  1. The CR-0036 mining-data audit is complete.
  2. Every mining dependency has been re-pointed away from mining.
  3. Production absence of mining has been DEMONSTRATED, with evidence.
  4. User-data retention and migration requirements are resolved.

No premature DROP, TRUNCATE, archive or rewrite is permitted. No earlier CR may
drop, truncate, archive or rewrite mining data.

Navigation re-pointing is CR-0044 work, and it may be included there ONLY after
the underlying replacement surfaces are ready. Stage 2 therefore cannot begin
before the surfaces it re-points to exist.

Mining is not deleted because it is old. It is deleted only after its absence
from production is proven and its data has been audited.

---------------------------------------------------------------------------
8. CHANGE-RECORD SEQUENCE
---------------------------------------------------------------------------

  CR-0035  This document. Documentation-only baseline amendment. No code.
           Approved at commit 13456ec5ada5df652f6b4f40c6c77cbd3de5bbec, then
           corrected by CR-0035A. Sequence correction only.

  CR-0036  Mining-data audit and dependency inventory. STRICTLY READ-ONLY.
           This is the FIRST step. It implements nothing.
             - Read-only production audit.
             - Inventory existing mining users and data.
             - Inventory every dependency from mining into funding, purchases,
               rewards, ledger, risk, audit, navigation, APIs and tests.
           It MUST NOT: change schema, shut mining down, delete mining, mutate
           data, or begin any new economic-simulation implementation.

  CR-0037  Economic-simulation foundation.
             - Game account and economic identity.
             - Virtual cash.
             - Core economic audit events.
             - Server-authoritative foundation.
             - Feature flag.
             - Security, RLS, idempotency and concurrency foundations.

  CR-0038  Asset catalogue and seasons.
             - Stocks and assets catalogue foundation.
             - Seasons.
             - Asset metadata.
             - NO live market simulation yet.

  CR-0039  Deterministic market engine.
             - Lazy-on-read.
             - Canonical epoch.
             - Deterministic seed.
             - NUMERIC(38,12) pricing, per 89 section 2.
             - Deterministic final rounding, per 89 section 5.
             - Market state and price computation.

  CR-0040  Trading.
             - Orders.
             - Positions.
             - P&L.
             - Fees.
             - Server-authoritative execution.
             - Idempotency and concurrency.

  CR-0041  Fictional crypto.
             - Virtual coins.
             - Virtual wallet identifiers.
             - Transfers.
             - Simulated transaction hashes, confirmations and network mechanics
               where appropriate.
             - NO real blockchain custody and NO external transfer. See section 5.

  CR-0042  Player-to-player trades and marketplace.
             - Custom trades.
             - Atomic acceptance.
             - Marketplace listings.
             - Reputation and trade history.
             - No duplicated monetary system.

  CR-0043  Jobs and life economy.
             - Jobs.
             - Wages.
             - Expenses.
             - Skills.
             - Businesses and life-economy foundations.

  CR-0044  Store and governed reward and UI integration.
             - Generalize the existing paid-perks and funding-spend system
               (CR-0017). See section 6.
             - NO second store, order or payment architecture.
             - Integrate the already-existing provisional earnings projection
               (CR-0034b, migration 064) WITHOUT turning it into money.
             - Virtual economy, provisional earnings and governed real-money
               rewards stay strictly separated. See section 2.
             - Navigation and re-pointing may be included ONLY after the
               underlying replacement surfaces are ready.

  CR-0045  Final mining retirement. The ONLY destructive CR.
             - ONLY after the CR-0036 audit.
             - ONLY after all mining dependencies have been re-pointed.
             - ONLY after production absence has been demonstrated.
             - ONLY after user-data retention and migration requirements are
               resolved.
             - NO premature DROP, TRUNCATE, archive or rewrite.

Every CR MUST record its own change record per 81_CHANGE_MANAGEMENT.md.

WHY THE SEQUENCE WAS REORDERED (CR-0035A)

Approved baseline: commit 13456ec5ada5df652f6b4f40c6c77cbd3de5bbec.

Two changes of substance, both ordered by RISK and PREREQUISITE rather than by how
visible a feature is:

CHANGE A: THE STORE MOVED CR-0042 -> CR-0044.
   The store is the only surface in this roadmap that touches the real-money order,
   product, entitlement and payment-submission machinery built by CR-0017, and the
   only one that carries the provisional-earnings projection. Under the previous
   ordering it sat in the middle, between fictional crypto and jobs, which would
   have put a real-money-adjacent surface into production before the virtual economy
   it sells into even existed. It is now last among the virtual-economy change
   records, behind assets, market, trading, crypto, P2P and life.

CHANGE B: PLAYER-TO-PLAYER TRADES AND THE MARKETPLACE MOVED CR-0044 -> CR-0042.
   Custom trades, atomic acceptance, marketplace listings and trade history are
   pure Layer-1 virtual mechanics. Their prerequisites are assets (CR-0038) and
   trading (CR-0040), both complete by CR-0042. They depend on no real-money surface
   at all, so deferring them to CR-0044 - as the previous ordering did, bundled with
   navigation - held low-risk work behind the roadmap's highest-risk work for no
   benefit.

One consequence is worth stating plainly. The previous ordering placed navigation
re-pointing in CR-0044 alongside custom trades, on the assumption that something
would exist to point at. Under the corrected sequence, navigation re-pointing may be
included ONLY once the replacement surfaces are ready. Re-pointing navigation before
that would leave users with a dead link, which is a production regression and not a
retirement.

NOT CHANGED: sections 1-5, 9 and 10, every architectural law, the three-layer
separation, the BIGINT and NUMERIC typing rules in 89, the four retirement stages in
section 7, and the fact that CR-0036 is first and strictly read-only. No substantive
CR-0035 design was altered by this correction.

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
data. CR-0035 and CR-0035A are documentation-only. The first step is CR-0036, which
is strictly read-only and implements nothing. The first IMPLEMENTATION is CR-0037.