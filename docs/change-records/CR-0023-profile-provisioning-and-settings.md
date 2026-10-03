# CR-0023 - Profile provisioning, account states, and the Settings page

Date: 2026-10-03
Status: APPLIED to migrations 044, 045 and 046. **Verified live**: 15 suites / 314
assertions / 0 failures.

## The user-visible symptom

**Every user saw "Account restricted" on the home page.** Reported directly.

## Root cause: two defects that compounded into a permanent lockout

The chain:

1. `signUpAction` calls `ensure_my_profile` over the service role.
2. If that RPC **fails**, the error is only `console.error`'d and signup still returns
   success. No retry, no backfill.
3. There was **no trigger on `auth.users`**, so the profile row depended entirely on
   that one app-layer call.
4. `getProfile` returns `null` when no row exists.
5. `isAccountActive(null)` evaluates `undefined === 'ACTIVE'` → `false`.
6. The dashboard rendered "Account restricted" and offered _Contact support_.

**A. Provisioning was not guaranteed.** A comment was the only enforcement, and a
comment is not enforcement.

**B. The UI conflated two different states.** `session.ts` documented `null` as
_"a legitimate state: a new signup is not an error"_ — then the dashboard rendered it
as _"this account is not currently active"_. A missing profile row is not a suspended
account.

Fixing either alone would have masked the other. Both are fixed.

## What was built

| Migration | Purpose                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 044       | `provision_user_profile` (the single writer), `handle_auth_user_created`, `after insert` trigger on `auth.users`, `backfill_missing_profiles`, and `ensure_my_profile` reduced to a delegate |
| 045       | Alignment correction - see below                                                                                                                                                             |
| 046       | `update_my_display_name` + entry point, for Settings                                                                                                                                         |

Application: `accountAccessState` (ACTIVE / RESTRICTED / UNPROVISIONED), the
dashboard now renders three distinct states, `PATCH /api/profile`, and
`/settings`.

## THE BACKFILL IS SAFE BY CONSTRUCTION

`backfill_missing_profiles` **inserts only where no profile row exists**. There is no
update branch, so it cannot alter `account_status` on an account an operator
deliberately suspended. The suite asserts this directly against a SUSPENDED account,
and a CONTROL assertion first proves the test is looking at a genuinely missing row.

This was raised as a risk before running, and the answer is that the safety property
is structural rather than procedural — the function has no code path that could
un-restrict anyone.

## Three defects found by RUNNING the suite

**1. My own migration had a permanent gap.** 044's trigger provisioned every signup;
044's backfill filtered on `email_confirmed_at is not null`. That inconsistency
created a real hole: the trigger is **INSERT-only**, so an account that existed
before it, signed up unconfirmed and confirmed later would get a profile from
**neither** path — and would render "Account restricted" forever, the exact defect
044 exists to fix. Migration 045 removes the filter and adds a confirmation trigger.
Found by `profile_provisioning.sql`, not by review.

**2. `is()` on a composite row.** `is(app_private.provision_user_profile(...), uuid)` —
`is()` compares scalars, so a composite raised `function is(app.profiles, uuid,
unknown) does not exist` and aborted the suite.

**3. An inline `FROM` inside `ok()`.** The same assertion style as (2) in a
different function: a `FROM` clause cannot sit in `ok()`'s first argument without a
subquery. `syntax error at or near "from"`.

Two of these three are the same mistake I have now made repeatedly — passing a row
where a scalar is required. The plan count was also wrong twice (14, then 15, actual
16).

## An honest limitation

`supabase db push` **suppressed the migration's `RAISE NOTICE`**, so the number of
accounts the backfill actually repaired is not visible in the CLI output. The NOTICE
is still correct and will surface wherever notices are not filtered, but the
immediate question — "did this fix my account?" — has to be answered by loading
`/dashboard`. If it now renders the normal dashboard, the backfill found and
repaired the row.

## Invariants held

- **No client action can set `account_status`.** `update_my_display_name` has no
  parameter that could reach it; asserted by inspecting `prosrc`. A settings endpoint
  that accepts an account status is one deploy away from letting a user un-suspend
  themselves.
- **Doc 67 BOLA** - the display-name command scopes by BOTH the session id and the
  record id, so another user's profile is _unknown_, not _forbidden_.
- **Doc 09** - the Settings page states plainly that nothing on it can unlock
  earning, withdrawal or a balance.

## Outstanding

- **Notification preferences, session management and password reset** are absent
  from Settings, and the page says so rather than implying they exist.
- **Referral code** is Phase 1 and will land on this page.
- **No admin UI to change `account_status`** — it is writable only by SQL.

## Files changed

    supabase/migrations/20260930000044_profile_provisioning.sql   new
    supabase/migrations/20260930000045_backfill_trigger_alignment.sql  new
    supabase/migrations/20260930000046_display_name.sql             new
    supabase/tests/profile_provisioning.sql                        new (16 assertions)
    src/lib/auth/session.ts                                        accountAccessState
    src/app/(app)/dashboard/page.tsx                               three states
    src/app/(app)/settings/page.tsx                                new
    src/app/api/profile/route.ts                                   new (PATCH)
    src/components/settings/DisplayNameForm.tsx                    new
    src/app/(app)/layout.tsx                                       Settings link
