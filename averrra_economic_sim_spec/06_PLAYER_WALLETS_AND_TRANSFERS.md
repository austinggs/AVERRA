# 06 — PLAYER WALLETS AND TRANSFERS

## Wallet model
Every game account gets:
- one Virtual NGN wallet
- one virtual wallet per enabled fictional coin

## Wallet screens
Show:
- balance
- 24h change
- current value in virtual NGN
- transaction history
- receive address
- send form

## Send flow
1. User selects asset.
2. Enters recipient address.
3. Enters amount.
4. Client validates formatting only.
5. Server validates balance/ownership/restrictions.
6. Server creates a pending transfer transaction.
7. Server atomically debits sender, credits receiver, and posts fee.
8. Transaction becomes CONFIRMED.
9. Both users receive an activity event.

## Transaction IDs
Use an opaque random ID plus a human-friendly reference.
Do not use sequential IDs as security tokens.

## Idempotency
Every mutating endpoint requires an idempotency key.
Repeated requests return the original result.

## Audit trail
Store immutable transfer records:
- transaction ID
- asset
- from user
- to user
- amount
- fee
- timestamp
- resulting status
- request id / idempotency key

## Reversals
Normal user transfers are irreversible once confirmed.
Admin corrections must be separate compensating transactions; never edit historical transfer rows in place.
