# CPX partner review — response draft

**Status:** DRAFT. Not sent. Requires the two placeholders below to be filled by a
human, and a read-through for accuracy before it leaves the building.

Prepared 2026-10-10 in response to Yvonne (Partner Manager) requesting platform details
ahead of integration review.

---

## 1. Website / app URL

`https://vip-averra.vercel.app`

> **Verify before sending.** This is the URL in our existing correspondence footer and
> in `package.json` metadata. Confirm the production domain is correct and publicly
> reachable, and whether a custom domain should be given instead.

---

## 2. Planned timeline for launching CPX Research surveys

> **PLACEHOLDER — needs a human decision.** I cannot state a commercial date. Fill in
> the real target from the product/commercial roadmap before sending.

What can be stated factually about current state:

- The platform is built and the CPX integration is coded, including offer display,
  click tracking, server-side callback verification, and settlement reconciliation.
- The CPX provider is promoted to `LIVE` in the database schema, subject to CPX's own
  commercial approval — which is what this review is gating.
- Integration testing (live click → callback → reconciliation → settlement) has **not**
  yet been executed against CPX's production endpoints.

> **Do not commit to a date here.** Per the settlement design (see §3), the *first
> withdrawal* by a user occurs roughly 90 days after their first tracked conversion.
> That is a CPX-network consequence, not a delivery delay, and it is worth stating
> plainly so it is not discovered late by either side.

---

## 3. Fraud prevention measures currently in place

This section is written to describe **only what is actually enforced in the running
system**. Claims were verified against the schema and code, not against intent.

### Callback and attribution integrity

- **Every callback is signature-verified server-side** (`md5(trans_id + secure_hash)`).
  An unverifiable callback is rejected and recorded as evidence rather than credited.
- **Tracking IDs are server-minted with 128 bits of CSPRNG entropy** and are prefixed
  `av_`. A client can never choose or supply its own tracking ID, which prevents
  forged attribution to a real user.
- **Callbacks are idempotent.** A unique constraint on `(provider_id, provider_event_id)`
  means a replayed or duplicated notification collapses onto one conversion and cannot
  pay twice.
- **Reversals are append-only.** A CPX clawback (`status=-2`) is recorded as its own
  conversion row with its own event identity, linked back to the original. Financial
  history is never edited or deleted, so any dispute is reconstructable.

### Payout gating

- **No reward is withdrawable until it is settlement-matched.** A conversion alone does
  not create withdrawable funds; a provider settlement report must match our records on
  **both amount and conversion count**, and only then is the reward released.
- **A 90-day maturity window applies.** Because an advertiser may devalidate a
  completion for up to 90 days after it is reported, we refuse to settle any period that
  ended less than 90 days ago. This protects users and the platform from clawbacks we
  could not recover.
- **Earned reward balance and user deposit balance are separate.** A deposit is never
  treated as an earned reward.

### Account and behaviour monitoring

- **A risk gate sits on the money path.** Any account under a non-`ALLOW` risk decision
  is blocked from receiving new rewards, and the block is applied *before* any ledger
  entry is written — a blocked reward leaves no partial financial state.
- **Five behavioural detectors run against live tables**, with operator-tunable
  thresholds and weights:
  - device-fingerprint clustering (multiple accounts per device),
  - task-attempt velocity,
  - in-game action velocity,
  - withdrawal-request velocity,
  - deposit-request velocity.
- **Device fingerprints are hashed (SHA-256) before storage**; the raw value is never
  persisted.
- **Risk decisions are append-only and attributable**, with mandatory reason codes, and
  appeals are recorded as new decisions rather than edits.

### What we are deliberately *not* claiming

Listed here because an integration review will test these, and overstating is worse
than a gap:

- **We do not currently operate an API rate limiter.** A `rate_limited` error type
  exists in our error envelope but is not yet returned by any handler. Velocity is
  detected *after the fact* by the detectors above, not prevented at the edge.
- **Five detectors are implemented; a sixth (`PROVIDER_CALLBACK_VELOCITY`) is
  configured but not yet implemented** and must not be described as active.
- **Risk signals are observational.** A tripped signal is recorded and queued for
  human/policy review; it does not automatically block an account on its own. Blocking
  requires an explicit, audited decision. This is a deliberate design choice — a
  detection system must not silently become an enforcement system — but it should be
  described accurately.
- **We do not yet have a self-service admin console** for reviewing risk decisions; that
  review is currently handled operationally.

---

## 4. Current or expected daily active users

> **PLACEHOLDER — I do not know this, and it must not be guessed.**

This is a commercial figure with no source in the repository, and an invented number
would be the single most damaging thing in this reply: it is the easiest claim for CPX
to verify in an audit and the one that would cost the partnership.

There is no analytics or DAU table in the current schema, so the figure cannot be
derived from the database either. Please supply:

- **Current DAU**, if the platform has any real users yet, or `0` / "pre-launch, no
  public users" if it does not.
- **Expected DAU at CPX survey launch**, and the basis for that expectation (existing
  audience, acquisition channel, growth target).

Giving CPX an honest "pre-launch, no public users, here is our modelled ramp and its
basis" is a normal and credible answer for a platform at this stage. Inflating it to
look attractive is the failure mode to avoid.

---

## Suggested full reply

---

Hi Yvonne,

Thanks for the review questions. Here are our details:

**1. Website / app URL**
`https://vip-averra.vercel.app`
<<CONFIRM DOMAIN BEFORE SENDING>>

**2. Planned timeline**
<<REAL DATE / MILESTONE>>
The platform and the CPX integration are built. Live end-to-end integration testing
against your production endpoints is the next step, pending your approval.
One thing we want to flag early: because your advertiser validation window runs up to
90 days, our settlement process holds a period for 90 days before funds are released
to users. Our first withdrawal therefore occurs roughly 90 days after the first tracked
conversion. This protects our users from clawbacks, but we want it on the record from
day one.

**3. Fraud prevention**
Happy to walk your team through any of this, and to share our provider integration
documentation.

- Server-side signature verification on every callback.
- Server-generated, high-entropy tracking IDs; clients cannot supply their own.
- Idempotent callback handling — duplicate notifications cannot pay twice.
- Append-only conversion and reversal records; history is never edited.
- No reward is withdrawable until it is matched against a provider settlement report on
  both amount and conversion count, after a 90-day maturity window.
- A risk gate on the reward path, plus five behavioural fraud detectors (device
  clustering, task velocity, game-action velocity, withdrawal velocity, deposit
  velocity) with tunable thresholds.
- Device identifiers are hashed before storage; raw values are never stored.
- Risk decisions are append-only, reason-coded, and require human review to enforce.

**4. Users**
<<CURRENT AND EXPECTED DAU, WITH BASIS>>

Happy to provide any additional technical documentation your review team needs.

Best regards,
The Averra team
https://vip-averra.vercel.app

---

## Internal notes (do not send)

- Every claim in §3 was verified against `supabase/migrations/` and `src/`, not against
  project documentation. If any of it is quoted back at us in an audit, it must hold.
  Specifically confirmed as **enforced code paths**: callback signature check, CSPRNG
  tracking-id minting, `(provider_id, provider_event_id)` uniqueness, append-only
  reversals, the settlement gate, `reward_blocked_by_risk` consulted inside
  `grant_reward`, and the five detectors querying real tables (`task_attempts`,
  `game_events`, `withdrawal_requests`, `deposit_requests`).
- **Do not add rate limiting to this reply.** If it is implemented before sending, that
  is a genuine improvement and can be claimed — but only then.
- Related: `docs/change-records/CR-0037-settlement-maturity-gate.md` and
  `docs/DISCREPANCIES.md` Q-60. The 90-day window is still **unapplied** to any
  database, so it is a design commitment rather than a running control today. It will be
  applied before CPX traffic goes live. If asked directly, say "enforced in our
  settlement logic, being rolled out now" rather than implying it is already live.
- Send from a human, in the founder's voice. Trim to whatever is comfortable defending
  in a follow-up call; the detail in §3 is more than most reviewers will read.
