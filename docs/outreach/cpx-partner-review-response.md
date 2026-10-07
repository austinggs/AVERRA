# CPX partner review - response draft

**Status:** DRAFT. Not sent. Two placeholders remain (S2 timeline, S4 forecast), and a
human must read the whole thing for accuracy before it leaves the building.

Prepared 2026-10-10 in response to Yvonne (Partner Manager) requesting platform details
ahead of integration review. Supersedes the first draft of this file, which contained
three claims that did not survive verification (see Internal notes).

Reconciles against `cpx-go-live-confirmation.md`, the note sent 2026-10-04, so CPX is
not left holding two inconsistent versions of our position.

---

## Full reply (send this)

---

**To:** Hello@cpx-research.com
**Subject:** Averra - partner review answers, and two updates to our last note

Hi Yvonne,

Thanks for the review questions. Answering each below, then flagging two updates to our
previous message so nothing is out of step.

### 1. Website / app URL

**https://averra.name.ng**

This is now our primary and canonical domain, live and serving the application. Please
use it for anything you send to users or link to publicly.

Our Vercel deployment (`https://vip-averra.vercel.app`) remains reachable and is the same
application on the same database, but we would ask that `averra.name.ng` be treated as the
address of record from here on.

Contact addresses, for your records:

- `admin@averra.name.ng` - please use this for partner and integration correspondence
- `support@averra.name.ng` - for user support matters

### 2. Planned timeline

<<REAL DATE OR MILESTONE - HUMAN INPUT REQUIRED>>

The platform and the CPX integration are built, including offer display, click
tracking, server-side callback verification, and settlement reconciliation. CPX is
configured as a live provider on our side, subject to your commercial approval. Live
end-to-end testing against your production endpoints is the next step.

One thing we want on the record early rather than discovered late: because your
advertiser validation window runs up to 90 days, our settlement process holds a period
for 90 days before funds are released to users. **Our first user withdrawal therefore
lands roughly 90 days after our first tracked conversion.** That is a property of your
network, not a delivery delay on our side, but it should be understood before go-live
rather than after.

### 3. Fraud prevention measures currently in place

We would rather describe than overstate, so this is what is genuinely enforced in the
running system today.

**Callback and attribution integrity**

- Every callback is signature-verified server-side before anything is credited. An
  unverifiable callback is recorded as evidence and pays nothing.
- Tracking IDs are minted server-side with 128 bits of cryptographic randomness. A
  client can never supply its own, which removes the most obvious forged-attribution
  path.
- Callbacks are idempotent. A duplicate or replayed notification collapses onto a single
  conversion and cannot pay twice.
- Conversions and reversals are append-only. A `status=-2` clawback is recorded as its
  own entry linked to the original. Financial history is never edited, so any dispute is
  reconstructable from our records.

**Payout gating**

- No reward is withdrawable until it matches a settlement report on **both amount and
  conversion count**. A conversion on its own does not create withdrawable funds.
- A 90-day maturity window applies, as described in S2.
- Earned reward balance and user deposit balance are separate domains. A deposit is
  never treated as an earned reward.

**Account and behaviour monitoring**

- A risk gate sits directly on the reward path. An account under a non-allow risk
  decision is blocked from receiving rewards *before any credit is written*, so a block
  leaves no reward, no ledger entry and no budget movement.
- Five behavioural detectors are built in the database - device clustering, task
  velocity, game-action velocity, withdrawal velocity and deposit velocity - each
  querying real transaction tables against configurable thresholds. **These are not yet
  invoked automatically; we are wiring them into the request path before launch.**
  Until that is done they inform a manual review rather than enforcing anything alone.
- Device identifiers, where collected, are stored only as SHA-256 digests. The raw
  value is not persisted.
- Risk decisions are append-only and reason-coded. An appeal adds a new linked record;
  the original decision is never altered.

### 4. Current and expected users

**Current: 0. We are pre-launch.**

The site is a working build, but it has no active users - there is no
existing audience to report. We would rather tell you that plainly than present a
projected figure as though it were measured traffic.

Expected DAU and the basis for it: <<HUMAN INPUT REQUIRED - see Internal notes>>

We would rather give you a forecast we can defend, with the reasoning behind it, than a
number chosen to look attractive. Once we have real traffic we will share actual
figures rather than projections.

Happy to provide integration documentation, walk your team through the reward path, or
answer anything the review team needs.

Best regards,
The Averra team
https://averra.name.ng

---

## Internal notes (do not send)

### Claims verified against code, not documentation

Each was checked in `supabase/migrations/` and `src/` rather than taken from a design
document. If any is quoted back in an audit, it must hold.

| Claim | Where it is enforced |
|---|---|
| Callback signature verification | `src/lib/providers/adapters/cpx-research.ts` |
| Entry-link hash differs from inbound hash | `cpxEntrySecureHash`; distinct test at `tests/providers/cpx-research.test.ts:597` |
| CSPRNG tracking ids | migration 060 |
| Callback idempotency | unique `(provider_id, provider_event_id)` |
| Append-only reversals | migrations 057/058, CR-0032 |
| Settlement match on amount AND count | migration 059, CR-0033 |
| 90-day maturity gate | migration 066, CR-0037 - **written, not yet applied** |
| Risk gate inside the money path | `reward_blocked_by_risk` consulted by `grant_reward` (CR-0028) |

### Corrections to the previous draft of this file

The first version would not have survived an audit. Three claims were removed or
softened, and each is worth remembering:

1. **"Five behavioural detectors with tunable thresholds"** was presented as an active
   control. It is not one. `app_private.detect_risk_signals` has **no caller anywhere in
   `src/`** and **no `public` wrapper**, so PostgREST cannot reach it either - the
   function is unreachable from the running application. It is granted to
   `service_role`, which grants permission, not a caller. The email now says the
   detectors exist but are not yet invoked.

   This is the same lesson as Q-59: a control nobody can reach is not a control.
   Verifying the function queries a real table proved the *logic* sound and said nothing
   about whether it *runs*.

2. **"Device identifiers are hashed before storage"** was misleading. `hash_observation`
   does SHA-256 and stores only the digest, which is correct - but **no client collects a
   device fingerprint at all**, so the hashing path has no input today. The claim now
   reads "where collected".

3. **`PROVIDER_CALLBACK_VELOCITY` is seeded but unimplemented.** It appears in
   `app.risk_detector_config` from migration 029, implying a control that does not
   exist, and is excluded from the detector count.

There is also **no API rate limiter anywhere** (Q-61), so do not claim one. If it is
built before sending, that becomes a genuine improvement worth adding.

### Domain went live 2026-10-10

`averra.name.ng` now resolves and serves the application (verified by fetching it - it
returns the real landing page, not a placeholder). S1 and the signature were updated from
"will move once DNS and TLS are live" to "primary and canonical domain, address of
record".

Two consequences that are easy to miss now that the domain is real:

1. **`NEXT_PUBLIC_SITE_URL` was absent from `.env.local` and is now required**, so the
   referrals page would have thrown on first request. It is set to `https://averra.name.ng`
   locally. **The same variable must be set in the Vercel project's environment
   variables** or the deployed referrals page throws for real users. A `NEXT_PUBLIC_`
   value is inlined at build time, so it also needs a rebuild to take effect.
2. **`metadataBase` was unset**, so Next.js resolved relative canonical/OG URLs against
   localhost and social previews would have pointed at a dead link. Now set in
   `src/app/layout.tsx`.

### Still unresolved

- **S2 timeline and S4 forecast** need human input. The forecast must carry its basis -
  acquisition channel, waitlist, or target market. "Pre-launch, 0 users" is a normal and
  credible answer at this stage; an unexplained growth number is what loses a review.
- **The 90-day gate is unapplied** to any database. If asked directly, say "enforced in
  our settlement logic, being rolled out now" rather than implying it is live. Migration
  066 must be applied before CPX production traffic.

### Hygiene

- Send from a human, in the founder's voice. Trim to whatever is comfortable defending
  in a follow-up call; most reviewers will not read S3 to the end.
- Insert the real `app_id` from `publisher.cpx-research.com` if the subject line needs
  it - it is on the deployment, not necessarily in `.env.local`.
- **Never include `secure_hash`, any API key, or the database URL** in outbound mail.
