# CR-0027 - Referral payout orchestration, read model, and admin monitoring

- **Status:** Complete
- **Date:** 2026-10-03
- **Supersedes:** nothing. Extends CR-0025 (qualification) and CR-0026 (reward funding).
- **Authorities:** 39_REFERRAL_SYSTEM.txt, doc 45 RELIABILITY, doc 87 section 12,
  71_ARCHITECTURAL_LAWS.md laws 8, 10, 39, 56.

## Why

CR-0026 shipped `pay_referral_reward`, proved it works, and left it with no caller. A
referral became `QUALIFIED` and stayed there forever. That is the same shape of defect
as `paid_perk_orders` (Q-38): working machinery with no driver.

This CR closes the loop and adds the operator visibility the programme has never had.

## Migrations

| Migration                               | Contents                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `053_referral_payout_orchestration.sql` | `enqueue_referral_payout` trigger; `claim_due_referral_payouts` sweep                               |
| `054_referral_read_model.sql`           | Superseded `get_referral_overview`; `get_referral_programme_stats`; `admin_fund_referral_programme` |
| `055_referral_overview_unit.sql`        | Corrects Q-39: re-declares `get_referral_overview` with `unit`                                      |

## The central design decision: the trigger enqueues, it does not pay

The obvious implementation - a trigger that calls `pay_referral_reward` - is wrong in
a way that loses money. A payout is a money movement. If it fails inside the
qualifying transaction, the whole qualification **rolls back**, and the user loses a
legitimate qualification because of a payment problem. There is no retry, no
visibility, and no dead letter.

So the trigger only records that a payout is due, in the same transaction as the
qualification. The payment happens later in the outbox worker, where a failure is
retried with backoff and a permanent failure is recorded in `last_error`. This is the
transactional outbox pattern already used for deposits, withdrawals and rewards.

## Three independent guards against a double payment

1. `uq_outbox_dedup` on `(event_type, aggregate_type, aggregate_id)` while `PENDING`
   or `PROCESSING` - one pending event per referral.
2. `pay_referral_reward` returns early when the referral is already `REWARDED`.
3. `grant_reward` is keyed on `referral-reward:<referral id>`.

The trigger fires only on the transition INTO `QUALIFIED`, so the recurring
`qualified_value_minor` updates that the qualification engine performs cannot
re-trigger a payout. This is asserted directly: the test updates the value on a
`QUALIFIED` row and requires the event count to stay at one.

## Failures are classified, not all retried

The handler logs and returns for two policy outcomes - the cap was reached, and the
programme is unfunded - because retrying cannot change either; they resolve when an
operator acts. Everything else throws, so it retries and is recorded. Both policy
outcomes are still logged, because a silently dropped event is the failure mode the
outbox exists to prevent.

## Not exposed to browsers

`pay_referral_reward` has no public RPC and no HTTP route. The worker calls it
server-side with the service role. `get_referral_programme_stats` and
`admin_fund_referral_programme` are capability-gated **in SQL** rather than in the
route, because a route can be bypassed and a function cannot. Funding takes an
explicit amount with no default, so the programme cannot be funded by accident.

## The money decision is still separate

The source remains **inactive and unfunded**. Applying `50,000,000` kobo requires
explicit operator confirmation and has not been done. Qualification now produces a
durable, observable, retryable record instead of a silent loss - which makes funding
a deliberate later act rather than a race against lost qualifications.

## A presentation-layer bug this work caught

`app.reward_state` has nine values and **no `SETTLED`**. The credited state is
`AVAILABLE`. The `MoneyState` presentation type is a different five-value enum. An
initial draft compared `reward.state === 'SETTLED'` against the database enum, which is
always false, so genuinely available referral money would have rendered in neutral
grey. `mapRewardState` now owns that mapping and is unit tested against every enum
value, including a test asserting that an unrecognised state fails closed rather than
rendering as available money.

Amounts are rendered as raw minor units with their unit, matching the dashboard and
wallet. This work initially rescaled to naira, which would have shown referral amounts
differently from every other amount in the product.

## Q-39 - an applied migration was edited

Migration 054 was pushed, then edited to add `unit`. `db push` never re-ran it,
because Supabase records a migration by version and never compares file contents. The
file described a function the database did not have, and the push reported success.

It was caught by querying `pg_proc.prosrc` directly. Typecheck, lint,
`check:migrations`, `check:grants` and all 409 pgTAP assertions passed, because none
of them compare the file to the database. Migration 055 supersedes it.

**Rule:** a migration is frozen the moment it is applied. Correct one with a new
migration.

## Verification

- 19/19 pgTAP suites, **409 assertions**, 0 failures
- 245 Vitest tests, 14 files
- `check:migrations` 189 functions, `check:grants` 91 public functions,
  `check:data-api` 83 tables, `check:bundle` clean
- typecheck, lint, build, `prettier --check` all clean
- Deployed state verified by query: `unit` present; all three new/changed functions
  report `has_function_privilege('anon', ..., 'EXECUTE') = false`

## Still open

- The programme is unfunded. `50,000,000` kobo awaits explicit confirmation.
- `claim_due_referral_payouts` is operator-triggered, not scheduled; there is no
  scheduler in the project yet (docs 60/61/62 unstarted).
- `paid_perk_products` is still empty, so no perk can be purchased. No product or
  price has been invented.
