# 12 — SECURITY AND ANTI-FRAUD

## General
Assume the client is hostile.
All economic calculations happen server-side.

## Authentication
Use existing AVERRA auth/session model.
Every state-changing server function verifies current user identity.

## Authorization
Users can access only:
- their own wallets
- their own positions
- their own orders
- public market data
- trades involving them
- their own store orders
- their own provisional earnings

Admin functions require explicit admin/service authorization.

## Replay defense
Every mutating request has an idempotency key.
Store result hashes or transaction IDs so replay returns the original result.

## Race defense
Use database transactions and row locking/advisory locks where needed.
Examples:
- two simultaneous sells cannot spend the same position twice;
- two trade accepts cannot consume the same asset twice;
- two payment approvals cannot double-grant;
- two sends cannot overdraw a wallet.

## Numeric safety
- Reject zero/negative amounts.
- Reject NaN/Infinity from JSON inputs.
- Enforce reasonable maximum quantities.
- Use integer minor units where possible.
- Never use floating point for balances or accounting.

## Address abuse
Fictional wallet addresses are identifiers, not auth credentials.
Knowledge of an address alone must not authorize spending.

## Trade abuse
Add velocity limits:
- max offers/minute/user
- max transfers/minute/user
- max failed submissions/hour/user

Flag:
- rapid account-to-account cycling
- self-funded ring trades
- identical accounts repeatedly exchanging the same asset
- suspicious new-account bursts
- many accounts tied to the same device/IP fingerprint if such telemetry is lawfully available

## Promotional reward abuse
Server-side limits:
- one active participation entitlement per user
- campaign caps
- daily/monthly reward caps
- duplicate event suppression
- referral/provider safeguards already in AVERRA

Do not infer eligibility solely from client state.

## Audit
Every state-changing economic operation should emit an immutable audit event.
