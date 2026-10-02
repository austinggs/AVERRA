# CR-0008: Phase 8 growth systems

Date: 2026-10-01
Status: Implemented, pending database execution
Spec authority: 39_REFERRAL_SYSTEM, 42_ADVERTISER_PLATFORM, 41_ADVERTISING_SYSTEM,
05_REWARD_ECONOMICS, 71_ARCHITECTURAL_LAWS law 8, 10, 16

## Referral system

Migrations 023–024: `referral_codes`, `referrals`, and the three commands
`attribute_referral`, `qualify_referral`, `reward_referral`. Plus
`GET|POST /api/referrals`, a `/referrals` page, and `src/lib/referrals/overview.ts`.

## Doc 39 QUALIFICATION is a schema constraint, not a workflow step

Doc 39 says a referral "cannot be triggered merely by account creation". Two
constraints make an account-creation-only referral unrepresentable:

- `referrals_qualified_needs_event` — a row cannot be `QUALIFIED` or `REWARDED`
  without naming the server-recorded event that qualified it.
- `referrals_qualified_needs_timestamp` — and without a qualification timestamp.

`attribute_referral` therefore creates only an `ATTRIBUTED` row. Payment requires
`qualify_referral`, which compares SERVER-recorded earnings against a SERVER
configured threshold, and both figures come from the database, never the client.

Self-referral is refused by `referrals_no_self_referral`, so it is impossible
rather than merely detected. The function also checks it explicitly to return a
clear message rather than a constraint failure.

`reward_referral` calls `grant_reward` and never `post_ledger_entry`, with an
idempotency key derived from the referral id. A pgTAP test asserts exactly one
referral function calls `grant_reward`, and that it is the reward path.

## Risk signals are never queried for a user-facing read

Doc 39 TRANSPARENCY requires the user to see "referral status and why a reward is
pending or rejected without seeing sensitive risk signals".

The correct way to keep a signal out of a user-facing read is to never query it.
`overview.ts` selects four named columns and joins no risk, fraud, or device
table. That is a stronger property than filtering after the fact.

## Advertiser platform

Migration 025: `advertisers`, `campaigns`, `campaign_conversions`.

Two doc 42 rules are structural:

- **`campaign_budget_reservation_covers_promise`** — a `LIVE` campaign must have
  `budget_reserved_minor >= max_exposure_minor`. An underfunded campaign is
  unrepresentable, so there is no configuration that can promise money the
  advertiser did not fund.
- **`campaign_conversions_unverified_not_charged`** — an unverified conversion
  cannot carry a charge, so a reporting bug cannot bill on evidence alone.
  This is doc 42 BILLING enforced at the storage layer.

Law 16: the per-conversion reward lives on the campaign row. A conversion cannot
name its own reward.

## Gate status

Typecheck, lint, 143 unit tests, migration structure check (44 functions) all
pass. pgTAP is now 137 assertions across nine files, every plan count verified.

## Outstanding

- **No code-generation command.** `referral_codes` rows are created by an
  operator. There is no function that issues a code to a user.
- **No qualification trigger.** `qualify_referral` exists and is correct, but
  nothing calls it automatically when a referee earns. Doc 39 requires
  "thresholded earnings", so this needs a worker that watches verified earnings.
- **No advertiser admin UI.** Campaigns are readable through the service client
  only. There is no surface to create, fund, pause or report on a campaign.
- **No campaign-to-reward-source link.** A campaign is not yet bound to a
  `reward_sources` row, so `grant_reward` cannot yet be called with a campaign
  budget. The constraint supports it; the wiring does not exist.
- **Gamification (doc 47) is not implemented.** No XP, level, streak or badge
  tables. The Mining Game has a `game_players.xp` column but nothing advances it.
- pgTAP unexecuted (137 assertions, nine files); migrations unpushed by
  direction.
