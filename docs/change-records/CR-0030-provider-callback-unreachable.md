# CR-0030 - Provider callbacks were unreachable behind the route gate

- **Status:** Complete (code). Awaiting redeploy to take effect on production.
- **Date:** 2026-10-04
- **Authorities:** 08_PROVIDER_INTEGRATION.txt (callback requirements), doc 06,
  law 4 (callbacks authenticated and validated), law 12 (replaceable integrations).

## What was wrong

`src/proxy.ts` gated every path except `/`, `/sign-in`, `/sign-up`,
`/auth/callback` and `/reviews*`. `/api/providers/callbacks/[provider]` was not in the
allowlist.

Confirmed live against the deployed host, not inferred:

```
HTTP/1.1 307 Temporary Redirect
Location: /sign-in?next=%2Fapi%2Fproviders%2Fcallbacks%2Fcpx_research
```

**Every CPX postback would have received an HTML login page.** The ingest pipeline
would never be reached, so `app.provider_callbacks` would stay empty - no evidence, no
conversion, no log, no error. The observable state is indistinguishable from "the
provider has not sent anything yet", so the natural response would have been to
investigate survey targeting, geography, or the CPX account rather than an allowlist.

This is the same failure family as Q-38: a fully specified path with no writer, where
the absence of evidence reads as evidence of absence.

## The second defect, found while planning the capture

`ingestProviderCallback` returns before recording anything when no adapter is
registered:

```ts
if (!adapter?.verifyCallback || !adapter.handleCallback) {
  return { outcome: 'REJECTED', reason: 'no adapter is registered' };
}
```

That check precedes `recordCallbackEvidence`. So fixing only the routing would still
have left `provider_callbacks` empty, and the plan to "read the real payload and write
the adapter against ground truth" would have had nothing to read.

However, a non-`VERIFIED` result from `verifyCallback` **does** record evidence and
returns before `handleCallback`. That asymmetry is what makes a safe capture harness
possible.

## Why there is a capture adapter at all

CPX's postback format and signing scheme are **not publicly documented**, and the
sources disagree. One production integration documents
`md5(trans_id + secure_hash)` over `user_id/amount_local/status/trans_id/hash`; a
second sample verifies no hash at all; the largest known network running CPX documents
no postback hash. Their public docs give only the _outbound_ listing formula,
`md5(ext_user_id + '-' + secure_hash)`.

Writing verification against a guess fails **closed**, and closed here means every real
conversion silently rejected while the dashboard reads "no earnings yet".

`createCpxCaptureAdapter` therefore authenticates nothing. It is safe by construction:

- `verifyCallback` returns `UNSUPPORTED` for every input, with no code path that
  returns `VERIFIED` and no configuration that would change that;
- `handleCallback` is deliberately not implemented, so no conversion can be normalized;
- consequently no reward can be created;
- `app.provider_callbacks.verification_result` stays `UNSUPPORTED`, which is exactly
  what `idx_provider_callbacks_unverified` exists to surface.

The provider row remains `CANDIDATE` and no reward source exists, so
`canProduceReward()` is false and `get_active_provider_reward_source` returns null.

The capture adapter is **replaced and deleted** once the observed payload has been
read, rather than left alongside the real one - `registerAdapter` refuses a duplicate
code, correctly.

## The allowlist is exact, not a blanket prefix

`/^\/api\/providers\/callbacks\/[a-z0-9_]{2,64}\/?$/` - the same shape the route
itself validates. This keeps `/api/providers/*` and everything administrative private,
and stops `/api/providers/callbacksX/...` or a traversal-shaped segment from matching.

## Verification

The public-path decision was extracted from `proxy.ts` into a pure, unit-tested module
(`src/lib/auth/public-paths.ts`) rather than tested through the proxy, matching the
repository's pattern of testing decisions without their I/O.

**The negative case is the point.** Asserting only that the callback is public would
pass just as happily if the entire API were public, so the tests assert that
`/api/perks`, `/api/wallet`, `/api/withdrawals`, `/api/admin/*` and non-callback
provider routes all still require a session, that `/callbacksX` does not match, and
that a segment which is not a valid provider code is not treated as public.

**The guard was shown to fail.** The allowlist entry was removed and the suite re-run:
**2 tests failed**, and the file was restored byte-identically.

- 17 test files, **282 Vitest tests**, 0 failures
- typecheck, lint, build, `check:data-api` (83 tables), `prettier --check` clean
- pgTAP unchanged: 19 suites / 414 assertions / 0 failures (no SQL was touched)

## Not done here

- **No registry migration.** `cpx_research` stays `CANDIDATE`. The gates are not
  satisfied and no timestamp has been recorded.
- **No reward source.** `provider:cpx_research` does not exist, so nothing can pay.
- **No real adapter.** CPX postback verification is still unimplemented, by design.
- **`CPX_APP_ID` / `CPX_SECURE_HASH` are set on the deployment but not yet read by
  any code.** Nothing in the capture path needs them. They are added when the real
  adapter is written, and will be read lazily so a missing value surfaces as
  `UNSUPPORTED` rather than failing the Vercel build at module load.
