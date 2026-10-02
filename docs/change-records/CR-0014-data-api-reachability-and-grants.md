# CR-0014 - Data API reachability and the anon grant on public functions

Date: 2026-10-01
Closes: Q-19, Q-20, Q-21, Q-22 in docs/DISCREPANCIES.md

## Context

The Data API was returning PGRST002 on every request. The cause was a project
setting, not the repository: the exposed-schema list was empty, so PostgREST had
no schema to build a cache from and probed its `pg_pgrst_no_exposed_schemas`
sentinel. Setting it to `public` restored service. No application data was
exposed by that, because schema `public` contains zero tables.

Fixing it then exposed two defects that had been present all along.

## 1. Twenty-six commands were unreachable (Q-21)

`.rpc('name')` resolves only against EXPOSED schemas. All 26 money, identity,
provider, game and support commands lived in `app_private` with no `public` entry
point, so 27 of 51 RPC call sites returned PGRST202. The platform could not take a
deposit, pay a reward, process a provider callback, or run the outbox processor.

Migration 035 adds a thin `public` SECURITY DEFINER wrapper per command, same
signature, delegating to the command, granted to `service_role` only, plus
`public.get_task`, which existed in no schema while two call sites depended on it.

`app_private` remains unexposed. Exposing it would have been one click instead of
27 wrappers, and it is wrong: it would publish `grant_reward`,
`post_ledger_entry`, `rebuild_account_balances`, `reverse_reward` and
`assert_distinct_approver` to PostgREST, converting deliberate privilege
boundaries into a config accident.

Signatures were generated from the live catalog rather than retyped.

## 2. Twenty-nine wrappers were callable by anyone (Q-22) - SECURITY

Proven live with the publishable key an end user holds:

    POST /rest/v1/rpc/get_wallet_summary -> 200 {"userFunding": [], ...}
    POST /rest/v1/rpc/list_my_deposits   -> 200 []

A function in `public` is BORN executable by `anon`: PostgreSQL grants EXECUTE to
the PUBLIC pseudo-role, and Supabase's default ACL grants it to `anon` and
`authenticated`. A `grant execute to service_role` does not remove either; only
an explicit revoke does. Migrations 030/031/032/034 were inconsistent, and 29
wrappers were left open.

Migration 036 revokes from `public`, `anon` and `authenticated` on all of them.

Scoping by `p_user_id` prevents CROSS-USER access and did nothing about
UNAUTHENTICATED access. Both were needed and only one was in place.

## How the leak survived verification

Every check filtered the population before counting it. `get_wallet_summary` has
no `my` in its name, so `proname like 'get_%' and proname like '%my_%'` never saw
it, and the empty result was reported to the user as a security assurance. This is
recorded in AGENTS.md as a standing rule, alongside the two earlier gates that
failed the same way.

## New gates

- `npm run check:grants` - a `public` function must revoke from `public`, `anon`
  and `authenticated`, and must revoke before it grants. Verified by re-injecting
  each defect, and clean against the existing migrations.
- `check:migrations` gained a cross-file delegate-arity check. Two real defects in
  035 were invisible to it: a missing function name in the signature, and
  `outbox_backlog(status, event_count)` calling a zero-argument function. Both
  compiled. The check is proven against all three.

## Verification

After applying 035 and 036 to the live project:

    exposed RPC endpoints          56
    non-RPC (table) paths          1   (just "/")
    src .rpc() call sites          51, unreachable 0
    anon can execute (app fns)      0
    authenticated can execute       0
    PUBLIC role can execute         0
    service_role can execute       56
    extension functions touched     0
    get_wallet_summary, anon key    401

## Outstanding

- `alter default privileges` for schema `public` must be run once as the postgres
  superuser. It cannot be self-applied from a migration. Until then a new function
  is born open again. SQL is in migration 036.
- pgTAP remains unexecuted; a suite asserting the privilege posture is still
  wanted, since it needs a database and cannot be a static lint.
- `SUPABASE_SECRET_KEY` and the database password were exposed in conversation
  and must be rotated.
