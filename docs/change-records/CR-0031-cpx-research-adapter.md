# CR-0031 - CPX Research adapter, verified against a live postback

- **Status:** Complete. Two follow-ups remain open and are listed at the end.
- **Date:** 2026-10-04
- **Authorities:** 08_PROVIDER_INTEGRATION.txt (callback requirements), doc 06
  (provider classes), doc 07 (eligibility gates), law 4 (callbacks authenticated and
  validated), law 5 (idempotency), law 12 (replaceable integrations), law 10 (traceable
  funding source).
- **Supersedes nothing.** CR-0031 completes the work CR-0030 deliberately deferred, and
  resolves the signing question CR-0030 recorded as open.

## The signature question is settled, by the vendor's own panel

CR-0030 recorded that CPX's postback signing scheme was undocumented and that four
external sources disagreed. The INFORMATION panel on the publisher's Postback Settings
screen resolves it verbatim:

> hash is a md5 hash: example: md5({trans_id}-yourappsecurehash)

So: a **hyphen** separator, and the signed input is the transaction id only. That is
what `cpx-research.ts` implements, and it was then confirmed against a live postback -
`app.provider_callbacks` id 5 records `signature_algorithm = md5(trans_id-secure_hash)`
with `verification_result = VERIFIED`.

**The signature binds `trans_id` and nothing else.** Amount, status, user and click
address are outside the MAC. An attacker who observes one valid callback and knows the
`trans_id` cannot forge the hash for a _different_ transaction, but the amount a callback
asserts is not authenticated by it. The amount-versus-configured-rate comparison
therefore stays in reconciliation and must never be treated as a cryptographic check.
Recorded here so the limit is not forgotten once the integration works.

## Three defects, all of them invisible from the outside

Every one of these produced a `200 {"status":"ok"}` to CPX and a dashboard showing
revenue credited, while Averra created nothing. That is the same failure shape as
CR-0030, one layer down.

### 1. Every callback was rejected on amount precision

The live test postback carried `amount_local=662.6500` - **four** decimal places - for a
0.50 USD conversion, while `amount_usd` arrived as `0.50` with two. `decimalToMinor`
compared raw fractional length against a fixed scale of 2, refused it, `handleCallback`
returned `null`, and `ingestProviderCallback` recorded `NORMALIZATION_FAILED`. This was
not a test artifact: **every** CPX callback would have failed, permanently.

The fix strips trailing zeros before the precision check. That is exact, not rounding -
`662.6500` and `662.65` are the same money, and the conversion performs no arithmetic on
the digits, only removal of zeros that carry no value. Genuine excess precision is still
refused: `662.6501` keeps its fourth place after stripping and is rejected, as is
`10.1230`, which reduces to `10.123`.

The old refusal was not stupid, and it is worth being precise about why it was aimed at
the wrong target. It protected against _our own_ arithmetic drifting. Here the drift was
the vendor's formatting. The rule is now deliberately narrow - "no information is lost" -
rather than the broader "at most two decimals".

### 2. The fraud reversal would have been discarded entirely

`classifyCpxEvent` matched only `status === '2'`. Their INFORMATION panel documents
`{status}` as "1 = completed, 2 = canceled", and that is the cancel path.

A **second advisory panel on the same screen**, visible only on the wider publisher
layout, says:

> Your postback URL will be called by us a second time, as soon as we cancel a
> transaction. &status=1 (pending) to &status=-2 (reversed).

So **`-2` is the fraud reversal**, and it is the one that arrives 15-60 days later -
precisely the event this system exists to catch. Matching only `'2'` classified `-2` as
`UNKNOWN` with a null conversion status, `handleCallback` returned `null`, and the
reversal was dropped with **no conversion row at all**.

That is worse than the duplicate problem found earlier in review. A duplicate at least
leaves the original visible; an unknown status leaves no trace that a reversal was ever
offered. `2` and `-2` are now both reversals, and both are reversible.

### 3. The source-IP check was comparing against the wrong machine

`CPX_POSTBACK_IPS` was compared against `ip_click`. CPX documents `ip_click` as **"user
click IP"** - the end user's address - while the whitelist is **"Postback Whitelist IP"**

- the vendor's postback servers. The comparison was false for essentially every callback
  while appearing to be a source check.

It now compares against the request's `remoteAddress`, and `ip_click` is recorded
separately as the distinct fact it is.

## A fourth finding, lower severity

`provider_callbacks.claimed_event_id` was `null` on a **signature-verified** callback.
`readClaimedEventId` looked only for `event_id`, which CPX does not send; their
transaction id is `trans_id`. The vendor's id therefore never reached the evidence
column, and reconciling a payout dispute meant reading `raw_payload` by hand. It now
falls back to `trans_id`. Recorded as evidence only - nothing downstream trusts it to
identify a paying user.

## The misconfigured URL, and why it produced no evidence at all

The URL first entered in the dashboard was `/callbacks/cpx` rather than
`/callbacks/cpx_research`, and every placeholder was bare - `?{status}`, `&{type}` - with
no parameter name.

Measured, not predicted. An unauthenticated probe to `/cpx` returned
`200 {"status":"ok"}`, byte-identical to a working request, and wrote **zero** rows,
because `ingestProviderCallback` rejects an unknown provider _before_ recording evidence.
A green tick in the vendor dashboard and an empty table here are the same event. That is
why the acceptance check for this integration is a table read, never an HTTP status.

## Verification

| Gate                                                   | Result                                |
| ------------------------------------------------------ | ------------------------------------- |
| `npm test`                                             | 19 files, 100 tests passing           |
| `npm run test:db`                                      | 19 suites, 414 assertions, 0 failures |
| `npm run typecheck`                                    | clean                                 |
| `npm run lint`                                         | clean                                 |
| `npm run build`                                        | clean                                 |
| `check:migrations` / `check:grants` / `check:data-api` | 0 errors                              |

The live payload from `app.provider_callbacks` id 5 is retained verbatim as a fixture in
`tests/providers/cpx-research.test.ts`. Both the amount and the IP defect were invisible
to invented payloads, which is the argument for keeping the real one.

**Every fix was proven by re-injecting its defect and confirming the suite fails**,
then restoring - trailing-zero stripping removed, `-2` removed from the reversal set, the
whitelist moved back onto `ip_click`, and the route's `GET` export deleted. A green run
on correct input is the weaker half of that evidence.

## Deliberately not done

- **No registry promotion.** `cpx_research` stays `CANDIDATE`. All seven doc 07 gate
  timestamps remain null and `canProduceReward()` is false.
- **No reward source.** `provider:cpx_research` does not exist, so nothing can pay.
- **No migration 057.** The append-only reversal - `reverses_conversion_id`, a `:2` /
  `:-2` event suffix so the follow-up is not collapsed by `uq_provider_conversions_event`,
  and `apply_provider_reversal` calling `reverse_conversion` - is **not** in this change.
  It is gated on the two open questions below.
- **No script-tag issuance and no `subid_1` binding.** The live postback carried an empty
  `subid_1`, so no event can yet resolve a paying user. The callback correctly landed as
  evidence with `UNRESOLVED_TRACKING_ID`.

## Open, and blocking before `INTEGRATION_TESTING`

1. **CPX contradicts itself about `status=1`.** Their INFORMATION panel says
   "1 = completed"; the advisory panel says "`&status=1` (pending)". Our classifier treats
   `status=1` + `type=complete` as payable. If `1` can mean pending, a survey the user has
   not finished could be paid. The test tool cannot distinguish the two, because it only
   ever sends the complete-survey event. **Needs written confirmation from CPX.**
2. **Whether the amount scale varies by field.** `amount_local` arrived with four decimal
   places and `amount_usd` with two. The trailing-zero fix handles both, but the vendor
   should confirm this is their formatting rather than something else.

Neither is a code problem, and neither should be resolved by guessing.

**The list is incomplete, measured not hypothesised.** The live postback arrived from
`44.204.183.114`, which CPX does not publish, while one from `157.90.97.92` is. Gating on
the published list would have dropped a real conversion, and every real conversion behind
it, with no error the provider could act on. The list stays evidence-only.
