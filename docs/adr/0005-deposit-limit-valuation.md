# ADR-0005 - Deposit-limit valuation basis

Status: Accepted
Date: 2026-09-30
Context docs: 38_PAYMENT_OPERATIONS.txt, 84; finding Q-03

## Context

Limits are stated in USD-equivalent units (min 5, max 500, rolling 24h 2,000) while the
on-chain amount is token-native. The snapshot requirement was defined only for displayed
conversions, leaving limit enforcement without an authoritative rate.

## Decision

1. Limits are enforced against the VERIFIED on-chain quantity converted with a snapshot
   captured at deposit-request creation - not at verification, not later.
2. Never use a client-supplied value.
3. Persist rate, source, timestamp and the tolerance decision on the deposit record.
4. Stablecoins default to par (1:1 USD) with a configurable depeg_tolerance_bps; a
   deviation beyond tolerance routes to NEEDS_REVIEW instead of auto-verifying.
5. Rolling 24h volume counts CONFIRMED USER_FUNDING_DEPOSIT ledger events, not requests,
   so unconfirmed submissions cannot exhaust or bypass a limit.

## Consequences

Depeg becomes a review case rather than an automatic conversion, matching doc 38.
