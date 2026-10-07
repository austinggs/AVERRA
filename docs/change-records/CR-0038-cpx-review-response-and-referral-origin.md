# CR-0038 - CPX review response, and a required public site origin

Date: 2026-10-10
Type: Documentation, configuration, one defect fix

## Why this exists

CPX's partner review asked for platform details ahead of integration approval. Drafting
an accurate, defensible answer surfaced three claims that could not be verified, and one
of them was a production defect found on the way.

## 1. The detectors were being claimed as active and are not

The draft described five behavioural detectors as a monitoring control in place. Checking
the call path rather than the function body showed `app_private.detect_risk_signals` has
**no caller in `src/`** and **no `public` wrapper**, so it is unreachable from the
running application. It is granted to `service_role`, which grants a permission, not a
caller.

Separately, no client collects a device fingerprint, so `hash_observation` - a correct
SHA-256 path - currently has no input.

This is Q-59's shape exactly: there, the only path to AVAILABLE had no reachable entry
point. **A control is defined by a reachable call path, not by an accurate function
body.** Verifying the logic proves nothing about execution.

Recorded as Q-62. The email now states the detectors exist and are not yet invoked.
Wiring them is a real design decision (per request, per task, or scheduled - and a
scheduled detector needs a worker that does not exist), so it is not done here.

## 2. `NEXT_PUBLIC_SITE_URL` was neither declared nor validated

The referral page built its share link as:

    `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/sign-up?ref=${code}`

With the variable unset - which it was, since it appeared in neither `.env.example` nor
the env schema - this produced a **relative** `/sign-up?ref=CODE`. No error. The link
looks correct on screen and does nothing once pasted into a chat app, so referrals
silently earn nobody. An acquisition path that is dead in production and throws nothing.

Fixed:

- `NEXT_PUBLIC_SITE_URL` is a required, URL-validated member of `publicEnvSchema`;
- the referral page reads it through `getPublicEnv()` and strips trailing slashes, so a
  declared `https://site.ng/` cannot produce `//sign-up`;
- declared in `.env.example`.

Required rather than optional is deliberate. An optional origin is exactly the
silent-fallback shape this replaces, and a broken share link is not a soft degradation.

### The test was proven to fail

`tests/env.test.ts` asserts the *shape of the failure* - that a missing value throws -
not merely that a value comes back. A test that only checked the returned origin would
have passed against the buggy code.

Per the rule in AGENTS.md, the schema line was temporarily made `.optional()` and the
suite re-run: 1 of 4 failed, the missing-value case. Restored and re-run green. A green
run on correct input is the weaker half of the evidence.

## 3. The partner response

`docs/outreach/cpx-partner-review-response.md` rewritten, and reconciled against
`cpx-go-live-confirmation.md` so CPX is not holding two inconsistent versions of our
position.

- Live URL is `https://vip-averra.vercel.app`; `averra.name.ng` described as pending
  DNS/TLS rather than presented as live.
- Partner correspondence via `admin@averra.name.ng`.
- The previously-impossible request for a go-live settlement report is withdrawn, and the
  already-disclosed 90-day maturity hold is restated plainly: the first user withdrawal
  lands ~90 days after the first tracked conversion.
- Per-click entry links and append-only `status=-2` handling documented.
- Current DAU stated as **0, pre-launch**, with the forecast left as a marked placeholder.
  No figure was invented.

## Still requires a human

- S2 launch timeline and the S4 forecast, which must carry its basis.
- Confirmation that a human actually monitors `support@averra.name.ng`. It is named in
  the draft as a contact address, so publishing it before that is answered would put an
  unmonitored address in front of a partner.
- Migration 066 remains unapplied. The 90-day gate is a design commitment until it is.

## Follow-up: domain went live

`averra.name.ng` went live on 2026-10-10 and was verified serving the application. Two
follow-on changes, both of which the live domain made urgent rather than cosmetic:

1. **`NEXT_PUBLIC_SITE_URL` set in `.env.local`.** CR-0038 made it required, and it was
   absent - so the referrals page would have thrown on its next request. Required a
   variable that a previous CR had never introduced is a real ordering hazard; the two
   changes should ideally have shipped together.
2. **`metadataBase` set in `src/app/layout.tsx`.** Without it Next.js resolves relative
   canonical and Open Graph URLs against localhost, so social previews pointed at a dead
   link the moment a real domain existed.

Note the deliberate difference in how the two values are read. The referral link uses
`getPublicEnv()` and fails loudly at first use, because a missing origin is a broken
acquisition path. `metadataBase` reads `process.env` with a known default, because
`export const metadata` is evaluated at module load during `next build` page collection -
validating there would fail the BUILD rather than the request, which is the failure
AGENTS.md already records from import-time env validation.

**Action required on Vercel:** `NEXT_PUBLIC_SITE_URL=https://averra.name.ng` must be set
in the project's environment variables and a rebuild triggered. A `NEXT_PUBLIC_` value is
inlined at build time, so setting it without redeploying changes nothing, and the deployed
referrals page throws until it is done.
