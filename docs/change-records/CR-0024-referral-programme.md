# CR-0024 - The referral programme: flag, issuance, and signup attribution

Date: 2026-10-03
Status: APPLIED to migrations 047 and 048. **Verified live**: 16 suites / 333
assertions / 0 failures. **The programme ships CLOSED** — see Outstanding.

## Why this file exists: the referral feature was inert

Reported as "the referral page doesn't work yet". It was not broken. It was honest,
and three separate things were missing:

1. **`app.referral_codes` was never written.** No INSERT existed in any migration, so
   `get_referral_overview` always returned `code: null` and the page rendered
   _"Referral codes are issued when the referral programme opens."_ That is **Q-38's
   shape for the third time** in this repository.
2. **`public.attribute_referral` existed and was granted to `service_role`** — the
   plumbing was built, and nothing ever called it, because the signup form had no
   referral field.
3. **`qualify_referral` and `reward_referral` existed and were never called.**

## The decision this implements

A code is issued **automatically at profile creation, behind a launch flag**, so every
user has one the moment the programme opens.

Attribution is captured **at signup only**. Doc 39 ATTRIBUTION says a code maps _a
new account_ to a referrer, and post-hoc attribution is the obvious abuse vector:
join now, claim later, once the programme is known to pay. The signup field says so.

## What was built

**Migration 047**

- `app.system_config` — typed key/value, RLS on, no browser grants. The seed of doc
  87 section 18, built now so it is not built twice.
- `referral_programme_open` — **ships `false`.** A programme that has not been
  announced must not start minting codes the moment a migration lands.
- `system_config_bool(key, default)` — one reader, so a flag is never parsed two
  ways. A **missing key returns the default rather than raising**, so adding a flag
  does not require every deployment to apply a migration first.
- `ensure_my_referral_code` — idempotent on `user_id`; returns `null` when closed,
  which is a normal result and not an error. Collision-retried so a unique violation
  can never abort profile creation.
- `provision_user_profile` — **redefined** to mint the code in the same call, so
  profile and code succeed or fail together.
- `backfill_missing_referral_codes` — opening the flag must reach the EXISTING user
  base, not only people who sign up afterwards.

**Migration 048** — entropy source correction, below.

**Application** — `?ref=CODE` prefill and an editable referral field on signup;
attribution in `signUpAction` after profile creation; the invite link and honest
copy on `/referrals`.

## Signup attribution never costs somebody their account

A failed attribution does **not** fail signup, and it is **reported** rather than
swallowed. Silently dropping a code somebody deliberately shared is worse than telling
them it did not work. Self-referral gets its own message because it is the user's own
typo, not a broken code.

## Two defects found by RUNNING the suite

**1. `gen_random_bytes` does not exist here.** 047 minted codes with
`encode(gen_random_bytes(8), 'hex')`. `gen_random_bytes` is **pgcrypto**, and the
function runs with `set search_path = app, pg_catalog`, which does not include the
schema pgcrypto lives in on Supabase.

The migration **applied successfully** — a plpgsql body is not validated at CREATE
time — and then failed on first call. That is the migration-034 trap one level up: a
syntactically perfect, semantically broken file that no structural gate can see. 048
uses `gen_random_uuid()`, which is core in PG13+ and is already the column default
throughout this schema.

**2. Composite row into `is()`, for the third time today.** Across the suites written
in this session: `app.profiles` into `is()`, `app.funding_spend_events.status`
selected from the wrong alias, and now `app.referral_codes`. `is()` compares scalars;
passing a row raises `function is(app.referral_codes, uuid, unknown) does not exist`
and aborts the suite. This is now a repeated, recognisable failure mode rather than a
surprise.

The plan count was also wrong again (18, actual 19).

## LAUNCH: the programme is OPEN (migration 049)

```sql
update app.system_config set value = 'true' where key = 'referral_programme_open';
select public.backfill_missing_referral_codes();
```

Applied as a migration rather than run by hand, so there is an audit trail of _when
the programme opened_. Closing it again is the same statement with `'false'`; codes
already issued stay valid, because a code that stops working the moment a switch
moves would be worse than either state.

## Three test-design defects found by opening it

Opening the programme broke three things in the tests, and all three were **my**
tests asserting on ambient state rather than controlling their own preconditions.

**1. `referrals.sql` asserted that the programme "ships closed."** That is a claim
about the AMBIENT database, not about the code. Migration 049 made it false and the
suite failed three assertions - all about the closed path, none of them wrong.

**2. The same suite set its precondition too late.** Moving the flag update to the top
of the file was not enough: the provisioning trigger fires during the `auth.users`
fixture INSERT, and the trigger is what reads the flag. The update has to come
_before_ the fixture, not merely before the assertions.

**3. `growth.sql` broke outright.** It creates a user and then inserts a referral
code with a known value, which it then selects by in four assertions. The new
trigger minted a code for that same user during the INSERT, and the manual insert
failed:

    duplicate key value violates unique constraint "referral_codes_user_unique"

An existing, previously-green suite, broken by a correct change. `growth.sql` now
closes the flag for its own duration: it tests attribution and anti-abuse with a
known code, not issuance, and `referrals.sql` covers issuance.

**The general rule, and it is the same one as Q-36 in a different costume: a test
that reads production state to establish its own precondition is not a test, it is a
snapshot.** Two suites asserting on the same ambient flag will collide the moment the
flag moves, and the failure will look like a defect in whichever suite is newer.

## Verification

    suites                16/16 executed
    assertions            334, failed 0   (was 333)
    referrals.sql         20/20
    app tables            82 (system_config added)

    check:migrations    OK - 174 functions, 0 errors
    check:grants        OK - 86 public functions, 0 errors
    check:data-api      OK - 82 app tables, no direct access
    typecheck / lint / test (239) / build / prettier    clean

The suite asserts BOTH flag states, so "issuance works" is not merely asserted with
the switch on. It also asserts that a CLOSED programme writes nothing, that
provisioning twice mints one code, that attribution alone creates no ledger entry
(doc 39's "cannot be triggered merely by account creation"), and that
`system_config` is unreadable from the browser.

## Outstanding — READ THIS

**Attribution is complete. The paying half is not.** `qualify_referral` and
`reward_referral` are still never called. Every referral sits at ATTRIBUTED forever —
correct, but nobody earns.

Three decisions are needed before that can be built, and I have deliberately not
invented any of them:

1. **What counts as "qualifying activity"?** Doc 39 says "verified activity or
   thresholded earnings" without defining either. Something must observe the
   referee's earnings and call `qualify_referral` with a server-recorded event id.
2. **What is the referral reward worth?** `reward_referral` takes an amount and a
   unit. Doc 39 mentions caps but no figure.
3. **`qualification_threshold_minor` defaults to 0**, so a referral would qualify on
   the very first qualifying event. A real number is needed.

**No late attribution.** By design, per doc 39 — but a grace window after signup would
be a change record, not a tweak.

## Files changed

    supabase/migrations/20260930000047_referral_programme.sql   new (5 functions)
    supabase/migrations/20260930000048_referral_code_entropy.sql  new (2 functions)
    supabase/migrations/20260930000049_open_referral_programme.sql  new
    supabase/tests/referrals.sql                               new (20 assertions)
    supabase/tests/growth.sql                                  fixture made hermetic
    src/app/(auth)/actions.ts                                  referral capture
    src/app/(auth)/sign-up/SignUpForm.tsx                      ?ref= prefill
    src/app/(app)/referrals/page.tsx                           invite link
