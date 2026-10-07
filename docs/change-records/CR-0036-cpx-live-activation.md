# CR-0036 - CPX Research LIVE activation

- **Status:** Complete. Two vendor questions remain open and are listed at the end.
- **Date:** 2026-10-07
- **Authorities:** `https://cpx-research.com/main/en/doc.php` (CPX's current official
  documentation; API section version 1.1, last updated 31-01-2025),
  `https://publisher.cpx-research.com/documentation/index.php` (script-tag schema),
  `https://cpx-research.com/main/en/index.php` (payment terms).
  Internal: doc 06 (provider classes), doc 07 (eligibility gates), doc 08 (integration),
  doc 13 (offerwall), `71_ARCHITECTURAL_LAWS.md` laws 2, 4, 5, 10, 12, 42.
- **Supersedes nothing.** CR-0031 built the adapter, CR-0032 the reversals, CR-0033 the
  settlement gate, CR-0034b the provisional projection. All four are unchanged except
  where noted below. This change makes the integration usable.

## The defect that made CPX impossible, whatever else was fixed

CPX requires `app_id` and `ext_user_id` on **every** documented integration method -
iframe, script tag and API - and describes `ext_user_id` as the field "used for
postback/s2s/webhook communication".

`createTrackingLink` set `subid_1` and nothing else.

That is not a subtle bug. With no `app_id`, CPX cannot tell which app a click belongs
to, so **no click was attributable to Averra at all**, and a perfect tracking id inside
it changes nothing. The link was well-formed and useless, and it returned HTTP 201 the
whole time.

The documented entry URL, from the IFRAME TAG section:

```
https://offers.cpx-research.com/index.php?app_id={app_id}
  &ext_user_id={unique_user_id}&secure_hash={secure_hash}
  &username={user_name}&email={user_email}&subid_1=&subid_2=
```

with, for the hash: _"You can generate it with your secure hash and the ext_user_id
information (e.g. for php `md5({unique_user_id}-{app_secure_hash})`)"_.

## Two hashes, one secret, and conflating them fails silently

| Direction           | Formula                           | Source                              |
| ------------------- | --------------------------------- | ----------------------------------- |
| Inbound postback    | `md5(trans_id + "-" + secret)`    | Postback Settings INFORMATION panel |
| Outbound entry link | `md5(ext_user_id + "-" + secret)` | `doc.php`, IFRAME TAG section       |

Same separator, same secret, **different input**. They are separate functions
(`verifyCallback` / `cpxEntrySecureHash`) rather than one helper with a parameter, and a
test asserts the outbound link does not use the inbound formula. Nothing throws when
they are confused - the link is simply never attributed, or every callback is silently
rejected.

## Attribution: what CPX documents, and what it does not

`ext_user_id` is mandatory, unique per user, and stable across sessions - CPX builds a
respondent profile from it, so it is the **Averra user id**, taken from the verified
session by the route and never from a request body. `subid_1` is the per-click
`tracking_id` minted by `begin_provider_participation`, and it is what **our** ingest
resolves the paying user from, through our own participation table.

**The signature authenticates neither.** It covers `trans_id` alone, so it proves a
callback came from CPX and does not prove that the `ext_user_id` or `subid_1` inside it
are the ones we sent. The outbound `secure_hash` binds the entry link for CPX's benefit
but is not echoed back, so it is not a verification mechanism on our side either.

So attribution rests on the tracking id being 128 CSPRNG bits, minted server-side and
never chosen by a client, plus the settlement gate. **This is not authenticated
attribution and must not be described as such.** Unpredictability raises the cost of a
forgery; the settlement gate is what actually stops money leaving.

## Files changed

| File                                                         | Change                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260930000065_cpx_live_activation.sql` | **new** - promotes CPX, seeds funding + offer, adds the settlement entry point, drops `href` from the listing |
| `supabase/tests/cpx_live.sql`                                | **new** - 21 assertions against the real seeded rows                                                          |
| `src/lib/providers/adapters/cpx-research.ts`                 | `cpxEntrySecureHash`; `createTrackingLink` emits `app_id`, `ext_user_id`, `secure_hash`, `subid_1`            |
| `src/lib/providers/adapters/cpx-contract.ts`                 | documents why `CPX_LOCAL_UNIT` is not configurable                                                            |
| `src/components/providers/OfferActions.tsx`                  | **new** - opens an offer through the click route                                                              |
| `src/app/(app)/earn/page.tsx`                                | anchor -> `OfferActions`; `href` dropped from the type                                                        |
| `tests/providers/cpx-research.test.ts`                       | `createTrackingLink` block **rewritten** (see below)                                                          |
| `tests/providers/click-route.test.ts`                        | provisions `CPX_APP_ID`/`CPX_SECURE_HASH`; three new assertions                                               |
| `.env.example`                                               | documents `CPX_APP_ID` and `CPX_SECURE_HASH`                                                                  |

Migrations 014, 031, 057-064 are **byte-identical**. Where a definition had to change
(`list_live_offers`) it is corrected forward with `create or replace`, per "an applied
migration is frozen".

## The tests were rewritten, not extended

The old `createTrackingLink` tests asserted that the link carried `subid_1` and nothing
else. Those assertions were **true, and they encoded the defect** - they would have
passed against a link that cannot work, which is worse than having no test. They now
assert CPX's documented contract, and the outbound hash is rebuilt independently in the
suite from the vendor's formula rather than by calling `cpxEntrySecureHash`, so the
suite does not merely prove the code agrees with itself.

**The new assertions were proven to fail.** Removing the `app_id` line and re-running
produced three named failures - `carries app_id, which CPX requires on every documented
entry method`, `issues a link carrying the app_id CPX requires for attribution`, and the
fail-closed case - then the file was restored and verified. A green run on correct input
is the weaker half of the evidence.

## What the pgTAP suite adds, and why it is not redundant

`provider_live_gate.sql` already proves the LIVE machinery, but it uses **fixture**
providers (`pglive_live`) and deliberately never touches the real rows. So every one of
its assertions stayed true while `cpx_research` sat at CANDIDATE - which is the state it
was in for its entire life. A green run was fully compatible with CPX never working.

`cpx_live.sql` asserts the real rows: provider LIVE with all seven gates recorded,
funding source present with a positive budget, **`currency_unit` equal to
`CPX_LOCAL_UNIT`**, the offer active and reachable, no `href` in the listing, the
settlement wrapper reachable by `service_role` and by nobody else, and
`transition_reward_ungated` still revoked from `service_role`. Read-only: no fixture, so
nothing can leak.

The currency assertion prevents a silent half-failure. `grant_reward` raises
`datatype_mismatch` on a unit mismatch, so a divergence would mean: conversion accepted,
evidence recorded, callback answered 200, reward then rejected - with nothing in the
vendor dashboard explaining why the money never arrived.

## What this deliberately did NOT do

- **The settlement gate is untouched.** `AVAILABLE` remains unreachable except through
  `settle_provider_period` on a report whose amount **and** count both match exactly.
  `settle_provider_period` and `transition_reward_ungated` are not re-typed, and the
  ungated revoke is asserted.
- **No provisional earnings for CPX.** Migration 064 filters
  `lifecycle_state <> 'LIVE'`, so promoting CPX moves it onto the governed path
  automatically. A CPX conversion cannot appear in the estimate surface and carry a real
  reward at once. The coupling is invisible in code, so it is asserted in `cpx_live.sql`.
- **No second ledger, balance, payout path or reward system.** The reward comes from the
  existing `apply_conversion_reward` -> `grant_reward` path.
- **No virtual-to-real conversion.** Nothing mints a withdrawable balance from a browser
  callback.
- **No other provider.** The `lifecycle_state <> 'LIVE'` rule is evaluated in SQL, so
  adding one later needs no code change (law 12).
- **No change to the reversal design** (migration 057/058), and none to CR-0033's gate.

## Settlement: no API exists, and that is the documented answer

CPX publishes **no** settlement or reporting API. Their documentation states invoices are
paid on agreed terms by bank transfer or PayPal with a $25 minimum ($100 for Bitcoin).
Reconciliation is therefore a **manual** operator action against a dashboard report.

`app_private.settle_provider_period` is the only path to `AVAILABLE` and has existed
since CR-0033, but it was **unreachable**: PostgREST resolves an RPC only against an
exposed schema and `app_private` is not exposed. Harmless while every provider was
CANDIDATE. The moment CPX went LIVE, rewards would have been created at PENDING and
could never become spendable - and the only "fix" an operator would reach for is a manual
`UPDATE` that bypasses the gate entirely. Migration 065 adds the single-statement
`public` wrapper, revoked from `public`/`anon`/`authenticated` and granted to
`service_role` only.

## Why `href` was removed from `list_live_offers`

It carried the raw `tracking_base_url` - no `app_id`, no `ext_user_id`, no `subid_1`. The
earn page rendered it as a direct anchor, so following it sent a user to CPX's wall
with nothing identifying. That is the same defect as the missing `app_id`, arriving by a
different route.

A per-user link cannot be produced by a cached, unauthenticated listing function: `app_id`
and the secret are server-only, and `ext_user_id`/`subid_1` exist only for a signed-in
user. So the field is removed and the earn page calls
`POST /api/providers/offers/[id]/click`, which mints the participation server-side from
the verified session. This is not a capability removal - that route already existed
(migration 063) and is the only correct way to open a provider offer.

## One offer, not one per survey

CPX's wall presents a rotating, per-user list of surveys matched to the respondent
profile. Seeding individual survey ids would go stale within hours, since CPX re-ranks
continuously, and would invite a payout figure that no longer applies. The wall is the
unit CPX actually sells, and its payout is genuinely variable per user - so
`displayed_payout_*` is NULL and the UI shows no figure rather than one we cannot stand
behind (doc 13 PRESENTATION).

## Verification

| Gate                | Result                                     |
| ------------------- | ------------------------------------------ |
| `npm test`          | 23 files, **397 tests passing**            |
| `npm run typecheck` | clean                                      |
| `npm run lint`      | clean                                      |
| `npm run build`     | clean                                      |
| `check:migrations`  | 208 functions, 0 errors                    |
| `check:grants`      | 100 public functions, 0 errors             |
| `check:data-api`    | 83 app tables, 131 files, no direct access |

`npm run test:db` requires `SUPABASE_DB_URL` exported into the process environment; the
runner does not read `.env.local`. It was **not** run here, so `cpx_live.sql` is
unexecuted against a live database. That is stated rather than implied.

## Deployment

1. Set `CPX_APP_ID` and `CPX_SECURE_HASH` in the deployment environment. Both from
   `publisher.cpx-research.com`. Neither may be prefixed with `NEXT_PUBLIC_`.
2. `npm run db:push` (applies migration 065).
3. In the CPX dashboard, set the postback URL to
   `https://<host>/api/providers/callbacks/cpx_research` with placeholders
   `status`, `type`, `trans_id`, `user_id`, `subid_1`, `subid_2`, `amount_local`,
   `amount_usd`, `offer_id`, `ip_click`, `hash`.
4. Confirm the publisher profile's local currency is NGN, since `amount_local` is
   recorded as `NGN-kobo`.

## Remaining open questions

1. **CPX still contradicts itself about `status=1`.** The INFORMATION panel says "1 =
   completed"; an advisory panel on the same screen says "`&status=1` (pending)". Our
   classifier treats `status=1` + `type=complete` as payable. **If `1` can mean
   pending, we could pay for an unfinished survey.** The settlement gate limits the blast
   radius - a wrongly-paid conversion still cannot become spendable unless CPX's own
   report matches - but this needs written confirmation from CPX.
2. **Whether the amount scale varies by field.** `amount_local` arrived with four decimal
   places (`662.6500`) and `amount_usd` with two. Trailing-zero stripping handles both
   exactly, and genuine excess precision is still refused, but CPX should confirm this is
   their formatting.
