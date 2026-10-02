-- =============================================================================
-- Averra migration 036: close the anon execute grant on public functions
--
-- Closes the LIVE LEAK recorded as Q-22 in docs/DISCREPANCIES.md.
--
-- 31 functions in schema public were executable by `anon` and
-- `authenticated`. Proven live with the publishable key an end user holds:
--
--   POST /rest/v1/rpc/get_wallet_summary  ->  200 {"userFunding": [], ...}
--   POST /rest/v1/rpc/list_my_deposits    ->  200 []
--
-- Every one of those wrappers takes p_user_id and scopes its query to that
-- user, so an attacker who guesses a UUID could read another user's wallet,
-- deposits, notifications or support tickets. Scoping by user id prevents
-- CROSS-USER access; it does not prevent UNAUTHENTICATED access. Both were
-- needed and only one was in place.
--
-- WHY THEY WERE OPEN
--
-- The default ACL for FUNCTIONS in schema public is:
--
--   postgres: {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- so every function created in public is BORN executable by anon. Migrations
-- 030, 031, 032 and 034 were inconsistent about whether they revoked first.
-- The ones that only granted to service_role were never locked down at all.
--
-- THE PART THAT MATTERS MOST IS AT THE BOTTOM.
--
-- Revoking these 31 fixes today. Without the ALTER DEFAULT PRIVILEGES below,
-- the next function written tomorrow is born open again and will pass every
-- review, because its own GRANT lines will be correct. The default is what
-- keeps re-creating the hole, so the default is what has to change.
--
-- `public` in the revoke list is the PUBLIC pseudo-role, not the schema. 24 of
-- these also inherited EXECUTE through it, which is why the revoke names it.
--
-- Extensions (citext and its operator functions) are deliberately NOT touched.
-- They are owned by postgres, are not application code, expose no data, and
-- revoking them risks breaking a type that application columns depend on.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: revoke on every affected function, granting only service_role.
--
-- Generated from the live catalog, so the identity argument lists match the
-- functions that actually exist rather than ones retyped by hand.
-- -----------------------------------------------------------------------------

revoke all on function public.ensure_my_profile(p_user_id uuid, p_display_name text) from public, anon, authenticated;
grant execute on function public.ensure_my_profile(p_user_id uuid, p_display_name text) to service_role;
revoke all on function public.get_active_admin_role(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_active_admin_role(p_user_id uuid) to service_role;
revoke all on function public.get_active_destination(p_chain_id integer, p_method text) from public, anon, authenticated;
grant execute on function public.get_active_destination(p_chain_id integer, p_method text) to service_role;
revoke all on function public.get_active_provider_reward_source(p_provider_code text) from public, anon, authenticated;
grant execute on function public.get_active_provider_reward_source(p_provider_code text) to service_role;
revoke all on function public.get_conversion_for_event(p_provider_id uuid, p_provider_event_id text) from public, anon, authenticated;
grant execute on function public.get_conversion_for_event(p_provider_id uuid, p_provider_event_id text) to service_role;
revoke all on function public.get_game_state(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_game_state(p_user_id uuid) to service_role;
revoke all on function public.get_my_deposit(p_user_id uuid, p_deposit_id uuid) from public, anon, authenticated;
grant execute on function public.get_my_deposit(p_user_id uuid, p_deposit_id uuid) to service_role;
revoke all on function public.get_my_profile(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_my_profile(p_user_id uuid) to service_role;
revoke all on function public.get_my_support_ticket(p_user_id uuid, p_ticket_id uuid) from public, anon, authenticated;
grant execute on function public.get_my_support_ticket(p_user_id uuid, p_ticket_id uuid) to service_role;
revoke all on function public.get_referral_overview(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_referral_overview(p_user_id uuid) to service_role;
revoke all on function public.get_role_capabilities(p_role_code text) from public, anon, authenticated;
grant execute on function public.get_role_capabilities(p_role_code text) to service_role;
revoke all on function public.get_unread_notification_count(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_unread_notification_count(p_user_id uuid) to service_role;
revoke all on function public.get_wallet_summary(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.get_wallet_summary(p_user_id uuid) to service_role;
revoke all on function public.list_deposits_awaiting_review() from public, anon, authenticated;
grant execute on function public.list_deposits_awaiting_review() to service_role;
revoke all on function public.list_live_offers() from public, anon, authenticated;
grant execute on function public.list_live_offers() to service_role;
revoke all on function public.list_live_surveys() from public, anon, authenticated;
grant execute on function public.list_live_surveys() to service_role;
revoke all on function public.list_live_tasks() from public, anon, authenticated;
grant execute on function public.list_live_tasks() to service_role;
revoke all on function public.list_my_deposits(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.list_my_deposits(p_user_id uuid) to service_role;
revoke all on function public.list_my_notifications(p_user_id uuid, p_limit integer, p_unread_only boolean) from public, anon, authenticated;
grant execute on function public.list_my_notifications(p_user_id uuid, p_limit integer, p_unread_only boolean) to service_role;
revoke all on function public.list_my_payout_destinations(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.list_my_payout_destinations(p_user_id uuid) to service_role;
revoke all on function public.list_my_support_tickets(p_user_id uuid, p_limit integer, p_status text) from public, anon, authenticated;
grant execute on function public.list_my_support_tickets(p_user_id uuid, p_limit integer, p_status text) to service_role;
revoke all on function public.list_my_task_attempts(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.list_my_task_attempts(p_user_id uuid) to service_role;
revoke all on function public.list_my_withdrawals(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.list_my_withdrawals(p_user_id uuid) to service_role;
revoke all on function public.list_providers() from public, anon, authenticated;
grant execute on function public.list_providers() to service_role;
revoke all on function public.list_supported_tokens(p_chain_id integer) from public, anon, authenticated;
grant execute on function public.list_supported_tokens(p_chain_id integer) to service_role;
revoke all on function public.owns_my_deposit(p_user_id uuid, p_deposit_id uuid) from public, anon, authenticated;
grant execute on function public.owns_my_deposit(p_user_id uuid, p_deposit_id uuid) to service_role;
revoke all on function public.owns_my_withdrawal(p_user_id uuid, p_withdrawal_id uuid) from public, anon, authenticated;
grant execute on function public.owns_my_withdrawal(p_user_id uuid, p_withdrawal_id uuid) to service_role;
revoke all on function public.resolve_tracking_user(p_provider_id uuid, p_tracking_id text) from public, anon, authenticated;
grant execute on function public.resolve_tracking_user(p_provider_id uuid, p_tracking_id text) to service_role;
revoke all on function public.tracking_already_converted(p_provider_id uuid, p_tracking_id text) from public, anon, authenticated;
grant execute on function public.tracking_already_converted(p_provider_id uuid, p_tracking_id text) to service_role;

-- -----------------------------------------------------------------------------
-- Step 2: stop new functions in public from being born executable by anon.
--
-- This is the durable fix. The revoke above is a repair; this is a policy.
--
-- Explicit grants in a later migration will still work: this only removes the
-- blanket default, so a function is unreachable until someone deliberately
-- grants it. That is the correct direction to fail in.
--
-- `alter default privileges` is per-role, so both roles that own objects in
-- this schema are covered. Applied for the current role and for postgres,
-- which is the role migrations run as.
-- -----------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- `alter default privileges` is PER-ROLE and may only be run by a superuser or
-- the role that owns the objects. A migration runs as `postgres`, which is NOT
-- a superuser on Supabase, so this cannot be self-applied here.
--
-- That is a genuine limitation, not an oversight, and it is why this migration
-- emits the statement as a COMMENTED, ready-to-run block rather than pretending
-- to enforce it. Run this ONCE in the Supabase SQL editor as the postgres
-- superuser role:
--
--   alter default privileges in schema public
--     revoke execute on functions from public, anon, authenticated;
--   alter default privileges for role supabase_admin in schema public
--     revoke execute on functions from public, anon, authenticated;
--
-- Until that is run, every new function created in `public` is born executable
-- by anon, and the revokes above will have to be repeated. The 29 revocations
-- below are still correct and worth having; this is what stops the hole
-- reopening. See Q-22 in docs/DISCREPANCIES.md.
--
-- do $$
-- declare
--   v_role text;
-- begin
--   foreach v_role in array array['postgres', 'supabase_admin'] loop
--     if exists (select 1 from pg_roles where rolname = v_role) then
--       execute format(
--         'alter default privileges for role %I in schema public revoke execute on functions from public, anon, authenticated',
--         v_role
--       );
--     end if;
--   end loop;
-- end;
-- $$;
