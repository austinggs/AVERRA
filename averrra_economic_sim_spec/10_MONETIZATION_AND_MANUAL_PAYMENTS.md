# 10 — MONETIZATION AND MANUAL PAYMENTS

## Principle
The game must remain playable for free.
Paid items should enhance convenience, personalization, access or content—not sell guaranteed profits.

## V1 store categories
- Employment/Premium Participation Pass
- Cosmetic profile frames
- Cosmetic wallet themes
- Extra chart themes
- Non-financial convenience items
- Optional virtual currency packages
- Optional starter bundles

## Example prices
These are configuration defaults, not promises:
- ₦100 — 30-day participation/employment pass
- ₦200 — cosmetic bundle
- ₦500 — premium cosmetic/quality-of-life bundle

Avoid selling direct "₦X real = ₦Y guaranteed virtual profit" mechanics that make the game feel like a financial product.

## Manual payment flow
1. User creates order.
2. Server generates unique order reference.
3. UI shows payment instructions.
4. User sends payment through the currently approved/manual method.
5. User submits transaction reference and optional receipt.
6. Order state = PAYMENT_SUBMITTED.
7. Admin reviews externally.
8. Admin clicks APPROVE or REJECT.
9. On APPROVE, server atomically marks payment verified and fulfills order.

## Order states
- CREATED
- PAYMENT_INSTRUCTIONS_SHOWN
- PAYMENT_SUBMITTED
- UNDER_REVIEW
- PAID
- FULFILLED
- REJECTED
- REFUND_PENDING
- REFUNDED
- CANCELLED

## Fulfillment
Every item uses an idempotent fulfillment key.
A second approval cannot duplicate virtual currency, entitlement, or item inventory.

## Admin controls
Admin can:
- view pending payments
- filter by order/user/date
- approve
- reject with reason
- view prior approval history
- see duplicate/reference conflicts
- trigger compensating grant only with explicit permission

## Evidence
Store:
- payment reference supplied by user
- amount claimed
- currency claimed
- payment timestamp supplied
- optional evidence file pointer
- reviewer
- reviewer action
- reason

Do not store unnecessary bank credentials or financial secrets.

## Future provider adapter
Implement a provider-neutral interface so a compliant processor can replace manual verification later without changing store/business logic.
