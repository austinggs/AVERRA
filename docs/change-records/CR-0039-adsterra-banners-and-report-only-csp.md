# CR-0039 - Adsterra banner subsystem and report-only CSP

## What this is

A provider-neutral, revenue-only banner ad subsystem on the landing page `/`, plus a
report-only Content-Security-Policy. Plus one refactor that removes CPX Research's
field names from shared provider ingestion code.

**No ad renders today.** Every `NEXT_PUBLIC_ADSTERRA_*` variable is unset, so
`readAdZone` returns null for every format and `AdSlot` emits nothing. That is the
intended state until an operator pastes real values from the Adsterra dashboard.

## The three rules this change is built around

**1. Revenue only. An ad impression is not a conversion.**

Adsterra pays us CPM/CPC for impressions. It is NOT a task provider: no row in
`app.providers`, no entry in `src/lib/providers/registry.ts`, no adapter. Nothing in
`src/lib/ads/` can reach a reward, a ledger entry, a wallet or a participation row.

The tempting future mistake is to "reward users for watching ads" or to attribute an
ad click to an offer. Both would make an ADVERTISEMENT a financial event, and ad
clicks are trivially forged - there is no signature over an ad click. That is a
different subsystem from a task provider postback and it would need its own design.

**2. Public routes only, enforced by auth's own definition.**

`isAdEligibleRoute` delegates to `isPublicPath` rather than keeping a second list of
public routes. There is exactly one definition of "public" in this repository, so an
ad cannot drift onto a sessioned route by being added to a separately-maintained set.

`/sign-in` and `/sign-up` are refused for a concrete reason rather than by category: an
ad over a credential form is hostile. `tests/ads/placements.test.ts` asserts both by
name and reports `7 candidates, 0 admitted` rather than an unqualified `ok`, so a
predicate that silently matched nothing cannot pass as proof.

**3. The loader URL is configuration, and the CSP derives from it.**

## The loader host was NOT invented

Adsterra's publisher documentation is JavaScript-rendered. Four independent attempts to
read a literal loader snippet during this change failed - the two documentation pages
returned generic homepage content, the help centre returned a fetch failure, and
DuckDuckGo and Bing both served bot challenges.

Per doc 78, a guessed host was not an option. The specific reason is worse than
"unknown":

```
wrong host in CSP script-src -> ad silently blocked
                             -> slot renders empty forever
                             -> page looks healthy in every screenshot
```

A wrong constant fails SILENTLY. So instead the operator pastes both the zone key and
the exact `<script src>` from their dashboard, and `adDeliveryOrigins()` DERIVES the
CSP allowlist from whatever is configured. Changing a zone URL changes the policy
automatically; `next.config.ts` is never edited. `tests/ads/csp.test.ts` asserts this
by swapping the loader host and asserting the new origin appears and the old one does
not.

`NEXT_PUBLIC_` on these variables is correct and is NOT the `SUPABASE_SECRET_KEY`
mistake. An Adsterra zone key is a public client identifier printed into the HTML of
every page that shows the ad. It authorizes nothing against our systems.

## The build failed where the tests passed

`next.config.ts` imported `./src/lib/ads/csp`, which imported `./config`. Next compiles
`next.config.ts` to CJS, and a Node `require` cannot resolve an extensionless `.ts`
specifier in a nested module:

```
Error: Cannot find module './src/lib/ads/config'
```

`tsc --noEmit`, `eslint`, and all 436 vitest tests passed. Only `next build` failed.

This is the AGENTS.md "a lint cannot see it" family one level up: the defect was
invisible to every static gate and appeared only at build time.

The fix is structural rather than a workaround. `src/lib/ads/delivery.ts` is now a
LEAF - it imports nothing - and holds the format list, the env readers, the origin
derivation and the CSP builder together, because all four must agree on which formats
exist and cannot do so by importing each other in a cycle. `next.config.ts` imports
only that file. `placements.ts` re-exports the format list.

**If a future change adds an import to `delivery.ts`, the build breaks immediately and
visibly.** That is the correct time to find out.

## CSP ships REPORT-ONLY, and that is a staged decision

Enforcing a CSP for the first time on a page that already works, in the same change
that introduces a third-party script, is how a deployment ends up with a blank white
home page and no obvious cause. Report-only logs what the policy *would* have blocked
while changing nothing about what renders.

`'unsafe-inline'` and `'unsafe-eval'` are still in `script-src`. Not laziness: Next's
runtime emits an inline bootstrap script and dev HMR re-evaluates modules, so a policy
without them blocks hydration on every route. They are logged as violations now so we
can see which directives are load-bearing before removing them.

The rollout, in order:

1. report-only, collect real violations on real traffic (this change)
2. allow the verified ad origins - already derived, not guessed
3. remove `'unsafe-inline'`/`'unsafe-eval'` via a nonce on Next's own scripts
4. flip to `Content-Security-Policy` via `cspHeaderName(false)`

Step 3 is why this was not a one-line change.

The permissive parts are OURS, not Adsterra's: `frame-src` and `connect-src` carry
only the derived ad origins. `worker-src 'self' blob:` is required by the Mining Game's
Three.js worker and is a worker source, not a script source.

## The report endpoint is public, and that is load-bearing

`/api/csp-report` is in `PUBLIC_PATHS`. A browser posts a violation report with no
credentials and often no session cookie. If the path were private, `src/proxy.ts`
would redirect the report to `/sign-in`, the browser would discard an HTML body, and
the report-only phase would collect nothing.

The failure is invisible in the most literal way: no violations, empty reports, and an
empty reports table looks exactly like a clean site. Enabling report-only while quietly
blocking reports produces a confident "CSP is clean" conclusion drawn from no data at
all - the same "0 bad out of an empty population" shape the leak check had.

The endpoint logs and does not store. It is attacker-reachable diagnostics with no
financial or identity content, and a table would be an unauthenticated write surface
with a retention obligation attached.

The body is size-capped at 16 KiB, checked on `content-length` BEFORE the read so an
oversized request is refused without being allocated, then re-checked on the decoded
string because `content-length` is a client-supplied hint that can lie or be absent.
Verified live: `204` valid, `204` malformed, `413` oversized.

## The provider-ingestion refactor

`src/lib/providers/ingest.ts` contained the literal `['event_id', 'trans_id']`.
`trans_id` is CPX's transaction-id placeholder, so one vendor's wire format was
compiled into the shared path every provider flows through - the coupling law 12 exists
to prevent.

The knowledge moved to where it belongs. Adapters now declare
`claimedEventIdFields`, and `readClaimedEventId` takes the field list as a parameter:

```ts
claimedEventIdFields: () => [FIELD.transactionId, 'event_id'],   // CPX
claimedEventIdFields: () => [FIELDS.eventId],                     // reference fixture
```

An adapter that omits it contributes no names and the column is recorded null. That is
a valid outcome - a shared default of `['event_id']` would reintroduce precisely the
guess being removed.

`claimedEventIdFields` is called inside a try/catch because it is adapter-supplied code
that also runs on the REJECTED path, where a throw would replace a clean rejection with
a 500 and lose the evidence write.

### The invariant test is a file-content test, on purpose

A behavioural test ("CPX's id is recorded") passes identically whether the name lives in
the adapter or is hardcoded in shared code, so it cannot detect a regression to the old
shape. `tests/providers/provider-neutrality.test.ts` reads the source and asserts the
ABSENCE of `trans_id`, `subid_1`, `CPX_SECURE_HASH` and `\bcpx\b`.

Comments are stripped before matching, because the shared files deliberately still name
CPX in prose explaining why the rule exists. Deleting that prose fails no behavioural
test and would leave the next person to re-add the array believing it was never tried.

`registry.ts` is held to a WEAKER rule than `ingest.ts`, and the difference is
deliberate: the registry's job is to import each vendor adapter, so naming a vendor
there is correct. What must never appear in either file is a vendor PAYLOAD FIELD NAME.

## Verify the checks can fail

Per AGENTS.md, a check that has never failed proves nothing.

- `validatePlacements` takes its input as a parameter precisely so tests can feed it
  broken tables. Five negative cases each assert a specific rule fires. A removed rule
  turns a test red.
- The CSP origin-derivation test swaps the loader host and asserts the old origin is
  GONE - a hand-maintained host list would fail this.
- The provider-neutrality test asserts `4 patterns, 0 violations` with the population
  printed, so a pattern that stopped matching is visible.
- The report endpoint's three status codes were confirmed against a running server.

Every count in the new suites is reported beside its population
(`7 candidates, 0 admitted`, `4 formats, 0 origins`, `2 files, 0 violations`), because
an unqualified `ok` is indistinguishable from a predicate that matched nothing.

Two test bugs were found and fixed by running them, worth recording because both were
in the TEST rather than the code:

- the first neutrality scan flagged `registry.ts` for `\bcpx\b`, because the regex
  matched the `cpx` in the import path `cpx-research`. Importing an adapter is by
  design; the rule was wrong, not the code.
- the first shape assertion required `readClaimedEventId`'s signature to contain no `[`
  at all. `readonly string[]` contains a bracket and is a TYPE. It now matches a literal
  array instead - a `[` immediately followed by a quote - which is what re-inlining
  `['event_id', 'trans_id']` actually produces.

## What is NOT done

- **No ad renders.** No zone is configured, because the zone keys and loader URLs are
  per-account values that exist only in the operator's Adsterra dashboard.

  An earlier draft of this document claimed that "traffic approval" was also required.
  **That was wrong and was removed.** Adsterra is self-serve: a publisher account can
  create zones and receive ad code immediately, with no manual approval step. The only
  thing standing between this code and a rendering ad is two pasted values.

  Nigerian ad-content obligations under the NPC are a question about the CONTENT an ad
  network may serve, not a vendor approval step, and they are unaffected by this
  correction.
- **CSP is not enforced.** Steps 2-4 above are outstanding, and step 3 requires a nonce
  so it is a real change rather than a header edit.
- **No popunder, social bar, interstitial or push.** `EXCLUDED_AD_FORMATS` records why
  each is withheld, so adding one means deleting a line that names the consequence.
- **No second ad vendor.** The modules are provider-neutral; Adsterra appears only in
  env var names and the operator's pasted URL.