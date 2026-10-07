# 11 — REAL REWARD LAYER

## Purpose
Provide a very small promotional reward layer that can coexist with the game without becoming the game's financial core.

## Hard separation
Real reward records must never be written into:
- virtual cash ledger
- fictional coin wallet tables
- portfolio positions
- stock/crypto trades
- P2P game transfers

## Provisional earnings
A read-only projection may aggregate eligible game/provider activity into:
- estimated amount
- currency
- event/transaction reference
- status `AWAITING_CONFIRMATION`

No field named `payable`, `confirmed`, or `settled` should be used in the public provisional payload.

## Activation
An active employment/premium participation entitlement can gate eligibility for certain promotional activities.
The entitlement itself does not guarantee a reward.

## Funding
Reward budgets are separate from store revenue accounting.
Existing AVERRA reward funding/settlement invariants remain authoritative.

## Qualification
Only server-side rules may create real reward records.
Client requests cannot mint a reward.

## Conversion into withdrawable balance
The existing AVERRA path remains the only financial authority:
- eligible business event
- reward created/validated
- funding source valid
- settlement conditions met where required
- reward becomes available
- payout follows existing safeguards

## Provisional UI
Use wording like:
`Estimated earnings — awaiting confirmation`
`Not withdrawable or spendable until AVERRA confirms it.`

Never display provisional earnings beside virtual cash without a clear domain label.

## Default launch cap
Recommended configurable cap: ₦200 maximum provisional promotional reward per active user per 30-day period.
Admin can set lower/higher values only through a controlled configuration path.

## No conversion rate from virtual wealth
Do NOT implement:
`virtual_profit × rate = real money`.
Real rewards must derive from independent qualifying activities/campaigns.
