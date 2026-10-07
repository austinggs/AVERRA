AVERRA — NUMERIC AND MONEY REPRESENTATION (AUTHORITATIVE)

Document: 89_NUMERIC_AND_MONEY_REPRESENTATION.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-10-07

PURPOSE

Fixes the storage types used for every monetary, price and derived economic value
in AVERRA, and the column naming that makes those types unambiguous. This applies
to the economic simulation (88) and, where it does not conflict with applied
migrations, to real money.

NORMATIVE LANGUAGE

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY
are used as engineering requirements.

---------------------------------------------------------------------------
1. MONEY AND ACCOUNTING VALUES — BIGINT MINOR UNITS
---------------------------------------------------------------------------

Any value that represents an AMOUNT of money, a BALANCE, a FEE, a PRICE PAID IN
MONEY, or an ACCOUNTING QUANTITY MUST be stored as:

    BIGINT   —   in MINOR UNITS

- Virtual NGN is stored in virtual KOBO (1 virtual NGN = 100 virtual kobo).
- Real amounts follow the existing AVERRA minor-unit convention already applied in
  migrations 040 and 043 (paid_perk_products.price_minor, paid_perk_orders.price_minor).

MUST NOT: real, double precision, float4, float8, money, or any binary floating
point type, for a balance or an accounting amount.

---------------------------------------------------------------------------
2. PRICES, RETURNS AND FACTORS — NUMERIC(38,12)
---------------------------------------------------------------------------

Any value that is a PRICE, a RATE OF RETURN, a FACTOR, a MULTIPLIER, a RATIO, or a
DECAY COEFFICIENT MUST be stored and computed as:

    NUMERIC(38,12)

Rationale: the simulated market requires fractional prices below the minor unit
(for example a coin whose nominal price is one minor unit), and requires returns
and compounding factors that have no integer representation. These are not
accounting amounts, so minor units are the wrong unit for them.

This applies to: open/high/low/close, limit prices, returns, betas, sector
factors, inflation index, volatility multipliers, event shocks, decay half-lives.

MUST NOT: real, double precision, or float for any of these.

---------------------------------------------------------------------------
3. FORBIDDEN REPRESENTATIONS
---------------------------------------------------------------------------

- PostgreSQL `real`, `double precision`, `float4`, `float8`, `money`.
- JavaScript `number` for any monetary or price value.
  A JS number MUST NOT be an authoritative stored value. Values crossing the wire
  MUST be transported as strings and parsed to BigInt (minor units) or a decimal
  library (NUMERIC). This is the same class of defect as the `bigint` column that
  PostgREST returns as a STRING: a typeof check that only accepts `number` silently
  yields zero for every real row.
- Float32 in game or client rendering of an authoritative amount.

---------------------------------------------------------------------------
4. COLUMN NAMING — `_minor` MEANS BIGINT, UNAMBIGUOUSLY
---------------------------------------------------------------------------

RULE: the `_minor` suffix is reserved EXCLUSIVELY for BIGINT minor-unit amounts.

Therefore:
- `*_minor`  ->  MUST be BIGINT in minor units.
- price/rate/factor columns -> MUST NOT carry a `_minor` suffix. Use `_price`,
  `_price_num`, `_rate`, `_factor`, `_index`, or the domain term.

This resolves the conflict in the external spec, which named price columns
`open_minor`, `close_minor`, `limit_price_minor` and `price_minor` while
simultaneously requiring fractional numeric prices. A NUMERIC(38,12) column named
`_minor` contradicts the convention that four applied migrations rely on, so the
COLUMN NAME gives way and the REQUIRED TYPE is kept.

Any table that mixes both (cash in minor units, asset price in numeric) MUST use
distinct suffixes, e.g. `cash_minor BIGINT` alongside `price_num NUMERIC(38,12)`.

---------------------------------------------------------------------------
5. ROUNDING — EXACTLY ONE FINAL STEP
---------------------------------------------------------------------------

- Market price computation MUST use PostgreSQL NUMERIC arithmetic end to end.
- There MUST be NO intermediate rounding. No per-step round(), no scale, no cast
  to a smaller type during the calculation.
- Exactly ONE rounding step occurs, at the end, when the final stored price is
  produced. That single rounding is deterministic and documented, and it MUST be
  the same for every reader at the same tick.
- Rounding MUST NOT depend on wall-clock time, session, user, or replica.

A calculation that rounds between steps is not reproducible from its inputs, and a
price that differs between two servers at the same tick is a correctness defect,
not a cosmetic one.

---------------------------------------------------------------------------
6. DETERMINISM
---------------------------------------------------------------------------

- A market price MUST be a pure function of (canonical epoch, tick index, asset,
  seed). Two servers computing the same tick MUST produce the identical value.
- Randomness MUST come from a seeded, deterministic source derived from those same
  inputs. Unseeded randomness is FORBIDDEN in any price path.
- A canonical epoch MUST be fixed and stored. Tick boundaries MUST be derived from
  it, never from "now" at read time.

---------------------------------------------------------------------------
7. STARTING VIRTUAL BALANCE — ENCODING
---------------------------------------------------------------------------

The external spec states "Starting cash: 1,000,000 virtual NGN" and defines the
minor unit as virtual kobo, 100 per NGN. It does not state the encoded integer.

RESOLVED: starting virtual cash is

    1,000,000 virtual NGN = 100,000,000 virtual kobo = 100000000 (BIGINT)

The alternative reading (1,000,000 meaning minor units) would be a 100x
difference in starting balance and MUST NOT be implemented.

---------------------------------------------------------------------------
8. REAL MONEY IS NOT AFFECTED
---------------------------------------------------------------------------

These rules govern the virtual simulation. Existing real-money types already in
applied migrations are frozen and are NOT restated here; this document does not
authorize retyping an applied migration (see AGENTS.md: an applied migration is
frozen, and a correction goes forward in a NEW migration).