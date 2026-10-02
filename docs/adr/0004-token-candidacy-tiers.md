# ADR-0004 - Token candidacy tier vs active production tier

Status: Accepted
Date: 2026-09-30
Context docs: 00_START_HERE.txt, 82_SOURCE_INDEX.md, 84; finding F-04

## Context

Doc 00 called USDT/USDC/USDm/USAT "the active allowlist" while doc 84 called the same
four a planning allowlist and required USDm/USAT to stay inactive until verified.

## Decision

1. deposit_token_candidates is the planning tier: USDT, USDC, USDm, USAT.
2. deposit_token_configs is the production tier, requiring a verified contract address
   and decimals, with is_active and verified_at.
3. The client receives ONLY rows with is_active = true AND a verified address.
4. All four seed inactive with no contract address. Never infer support from a ticker.
5. Native CELO is never accepted and is never a candidacy entry.

## Consequences

Candidacy is never presented to users as support, and an unverified address can never
be used as a matching key.
