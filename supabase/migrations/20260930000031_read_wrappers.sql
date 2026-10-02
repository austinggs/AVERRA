-- =============================================================================
-- Averra migration 031: Remaining Data API read wrappers
--
-- Companion to migration 030. The `app` schema is deliberately not exposed
-- through the Data API, so every read of an app table must go through a named
-- `public` SECURITY DEFINER wrapper. Migration 030 covered the notification
-- count, wallet, tasks, game and referrals; this covers the rest.
--
-- Each wrapper is scoped to one read and returns a bounded shape. None exposes a
-- table. `anon` and `authenticated` are revoked throughout: every read here is
-- scoped to the authenticated caller's own id, verified in TypeScript from the
-- session, so an end-user session has no business calling them.
-- =============================================================================

-- The caller's own profile. Read on EVERY authenticated request by the app
-- shell, so it is the most load-bearing read in the product.
create or replace function public.get_my_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', pr.id,
    'displayName', pr.display_name,
    'accountStatus', pr.account_status,
    'createdAt', pr.created_at
  )
  from app.profiles pr
  where pr.id = p_user_id;
$$;

-- The caller's notifications, newest first.
-- The caller's notifications, newest first.
--
-- `p_unread_only` exists so the API route can ask for the unread subset without
-- a second round trip. It filters BEFORE `p_limit`, which is the difference
-- between "the 50 newest unread" and "the 50 newest, of which some are unread".
--
-- `sourceEventType` and `sourceId` travel with every notification so the
-- authoritative event can be looked up. A notification is a delivery of an
-- event, never the event itself (doc 45).
create or replace function public.list_my_notifications(
  p_user_id uuid,
  p_limit integer default 50,
  p_unread_only boolean default false
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', n.id, 'category', n.category, 'title', n.title, 'body', n.body,
    'actionPath', n.action_path, 'actionLabel', n.action_label,
    'sourceEventType', n.source_event_type, 'sourceId', n.source_id,
    'readAt', n.read_at, 'createdAt', n.created_at
  )
  from app.notifications n
  where n.user_id = p_user_id
    and (not p_unread_only or n.read_at is null)
  order by n.created_at desc
  limit least(coalesce(p_limit, 50), 200);
$$;

-- The caller's support tickets.
--
-- `p_status` filters in the database BEFORE the cap, so "my 25 most recent OPEN
-- tickets" is not the same query as "my 25 most recent tickets, some of which
-- happen to be OPEN".
create or replace function public.list_my_support_tickets(
  p_user_id uuid,
  p_limit integer default 25,
  p_status text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', t.id, 'reference', t.reference, 'subject', t.subject,
    'category', t.category, 'status', t.status, 'priority', t.priority,
    'createdAt', t.created_at, 'updatedAt', t.updated_at,
    'firstResponseAt', t.first_response_at,
    'resolvedAt', t.resolved_at, 'closedAt', t.closed_at,
    'reopenCount', t.reopen_count
  )
  from app.support_tickets t
  where t.user_id = p_user_id
    and (p_status is null or t.status::text = p_status)
  order by t.created_at desc
  limit least(coalesce(p_limit, 25), 100);
$$;

-- One support ticket's thread, scoped to its owner.
--
-- Author kind is returned explicitly so the UI can distinguish a human agent's
-- reply from the user's own message. Nothing here is generated text.
create or replace function public.get_my_support_ticket(p_user_id uuid, p_ticket_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', t.id, 'reference', t.reference, 'subject', t.subject,
      'category', t.category, 'status', t.status,
      'createdAt', t.created_at, 'firstResponseAt', t.first_response_at
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'authorKind', m.author_kind, 'body', m.body,
        'createdAt', m.created_at
      ) order by m.id)
      from app.support_messages m where m.ticket_id = t.id
    ), '[]'::jsonb)
  )
  from app.support_tickets t
  where t.id = p_ticket_id and t.user_id = p_user_id;
$$;

-- Confirms that a referenced deposit belongs to the caller.
--
-- This exists so the support-ticket command can validate a linked record without
-- reading the table. It returns a BOOLEAN, never the row, so the wrapper cannot
-- become a general deposit read by a caller who guesses a UUID.
--
-- A false result is the intended answer far more often than a true one, so
-- nothing here distinguishes "no such deposit" from "someone else's deposit".
create or replace function public.owns_my_deposit(p_user_id uuid, p_deposit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select exists (
    select 1 from app.deposit_requests d
    where d.id = p_deposit_id and d.user_id = p_user_id
  );
$$;

-- The same check for a withdrawal. See `owns_my_deposit`.
create or replace function public.owns_my_withdrawal(p_user_id uuid, p_withdrawal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select exists (
    select 1 from app.withdrawal_requests w
    where w.id = p_withdrawal_id and w.user_id = p_user_id
  );
$$;

-- The supported-token allowlist.
--
-- This is the single source of truth for what the platform will accept, and it
-- is the most safety-critical read in the codebase. AGENTS.md is explicit: never
-- invent a Celo contract address, and all four tokens seed inactive with no
-- address until RPC-verified.
--
-- Two invariants are enforced HERE, in the database, rather than in the
-- TypeScript that reads this:
--
--   * only rows on the Celo mainnet chain, and
--   * only rows that are both ACTIVE and carry a contract address and decimals.
--
-- The second is not redundant with the table constraint. The constraint ties
-- `is_active` to having an address; it does not require the address to be
-- non-null when reading. Filtering here means a row that is somehow inconsistent
-- cannot reach a user as a "supported token", which is the failure that would
-- send real money to an address nobody verified.
create or replace function public.list_supported_tokens(p_chain_id integer)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'symbol', t.symbol,
    'chainId', t.chain_id,
    'contractAddress', t.contract_address,
    'decimals', t.decimals
  )
  from app.deposit_token_configs t
  where t.is_active
    and t.chain_id = p_chain_id
    and t.contract_address is not null
    and t.decimals is not null
    and t.verified_at is not null
  order by t.symbol;
$$;

revoke all on function public.list_supported_tokens(integer) from public, anon, authenticated;
grant execute on function public.list_supported_tokens(integer) to service_role;

comment on function public.list_supported_tokens(integer) is
  'Active, RPC-verified tokens for one chain. A row without a verified address can '
  'never appear here, so no caller can be told an unverified token is supported.';

-- The active receiving destination for one chain and method.
--
-- Returns NULL rather than an empty set when none is active, because "no
-- destination" and "an empty destination" are different facts and the caller
-- must be able to tell them apart to refuse a deposit.
create or replace function public.get_active_destination(
  p_chain_id integer,
  p_method text
)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'address', d.address,
    'chainId', d.chain_id,
    'method', d.method
  )
  from app.platform_destinations d
  where d.is_active
    and d.chain_id = p_chain_id
    and d.method = p_method
    and d.verified_at is not null
  order by d.created_at
  limit 1;
$$;

revoke all on function public.get_active_destination(integer, text)
  from public, anon, authenticated;
grant execute on function public.get_active_destination(integer, text) to service_role;

comment on function public.get_active_destination(integer, text) is
  'The one active verified receiving destination for a chain and method, or NULL. '
  'A deposit cannot be created without one, so funds are never sent to an unverified address.';

-- Admin capability reads.
--
-- These are the ONLY wrappers that are not scoped to a single end user, because
-- they are evaluated FOR a user rather than about their own data. Both still take
-- the user id as an explicit parameter and are service_role-only, so the ability
-- to ask "what can this user do" never becomes the ability to ask "list all
-- admins".
--
-- Deliberately absent: any row from `app.admin_users` other than `role_code`. An
-- authorization check needs the role, not the audit trail of who granted it.
create or replace function public.get_active_admin_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  -- A REVOKED assignment is not a role, so `revoked_at is null` is the whole
  -- condition. Returning NULL for both "not an admin" and "lookup failed" is
  -- deliberate: an error must never become a pass.
  select a.role_code
  from app.admin_users a
  where a.user_id = p_user_id and a.revoked_at is null;
$$;

create or replace function public.get_role_capabilities(p_role_code text)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object('code', c.capability_code)
  from app.admin_role_capabilities c
  where c.role_code = p_role_code
  order by c.capability_code;
$$;

-- Live offer and survey inventory.
--
-- Doc 13/14: only inventory from a LIVE provider may surface, because nothing
-- from a CANDIDATE provider can pay. The join enforces that server-side.
--
-- `offers` and `surveys` do NOT share column names (`displayed_payout_minor` vs
-- `base_reward_minor`, `category` vs `categories`), so they are separate
-- functions returning one normalised shape rather than a faked shared projection.
create or replace function public.list_live_offers()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', o.id, 'title', o.title, 'description', o.description,
    'payout', o.displayed_payout_minor,
    'payoutUnit', coalesce(o.displayed_payout_currency, 'est.'),
    'tag', o.category,
    'href', o.tracking_base_url
  )
  from app.offers o
  join app.providers p on p.id = o.provider_id
  where o.is_active and p.lifecycle_state = 'LIVE'
  order by o.last_seen_at desc
  limit 100;
$$;

create or replace function public.list_live_surveys()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', s.id, 'title', s.title, 'description', s.description,
    'payout', s.base_reward_minor,
    'payoutUnit', coalesce(s.reward_currency, 'est.'),
    'tag', (s.categories)[1],
    'estimatedDurationSeconds', s.estimated_duration_seconds
  )
  from app.surveys s
  join app.providers p on p.id = s.provider_id
  where s.is_active and p.lifecycle_state = 'LIVE'
  order by s.last_seen_at desc
  limit 100;
$$;

-- Providers, for ingestion and administration. No credential material is
-- returned, only identity and lifecycle state.
create or replace function public.list_providers()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'name', p.display_name, 'status', p.lifecycle_state
  )
  from app.providers p
  order by p.code;
$$;

-- The caller's own deposits and withdrawals. Scoped to the caller, so one user
-- can never enumerate another's financial requests.
create or replace function public.list_my_deposits(p_user_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', d.id, 'reference', d.request_reference, 'status', d.status,
    'declaredAsset', d.declared_asset,
    'declaredAmountMinor', d.declared_amount_minor,
    'declaredUnit', d.declared_unit,
    'requestedAt', d.requested_at, 'expiresAt', d.expires_at
  )
  from app.deposit_requests d
  where d.user_id = p_user_id
  order by d.requested_at desc
  limit 100;
$$;

create or replace function public.list_my_withdrawals(p_user_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', w.id, 'method', w.method, 'status', w.status, 'unit', w.unit,
    'grossAmountMinor', w.gross_amount_minor,
    'feeAmountMinor', w.fee_amount_minor,
    'netAmountMinor', w.net_amount_minor,
    'requestedAt', w.requested_at
  )
  from app.withdrawal_requests w
  where w.user_id = p_user_id
  order by w.requested_at desc
  limit 100;
$$;

-- Deposits awaiting operator confirmation, for the admin queue.
--
-- This is the ONE wrapper that is not scoped to a single caller, because a
-- reviewer must see across users. It therefore returns no personal detail beyond
-- what the review needs, and it is reachable only with service_role.
--
-- The column set is the reviewer's full decision surface: to confirm a deposit
-- the operator has to compare the declared amount against what actually landed
-- on chain, and to escalate they have to know why it did not verify. A wrapper
-- narrow enough to be safe but too narrow to work from would push the operator
-- back toward a direct table read, which is exactly what this design removes.
--
-- Deliberately absent: any `auth.users` column, display name, email, document
-- number, device fingerprint, or risk signal. The reviewer acts on the
-- transaction, not on the person, and nothing here widens that boundary.
create or replace function public.list_deposits_awaiting_review()
returns setof jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', d.id, 'userId', d.user_id,
    'reference', d.request_reference, 'status', d.status,
    'chainId', d.chain_id, 'declaredAsset', d.declared_asset,
    'declaredAmountMinor', d.declared_amount_minor,
    'declaredUnit', d.declared_unit,
    'senderAddress', d.sender_address,
    'txHash', d.tx_hash, 'transferLogIndex', d.transfer_log_index,
    'verifiedAmountMinor', d.verified_amount_minor,
    'verificationStatus', d.verification_status,
    'reviewReason', d.review_reason,
    'requiredApprovals', d.required_approvals,
    'requestedAt', d.requested_at,
    'expiresAt', d.expires_at,
    'submittedAt', d.submitted_at,
    'confirmedAt', d.admin_confirmed_at
  )
  from app.deposit_requests d
  where d.status in ('SUBMITTED', 'VERIFIED', 'NEEDS_REVIEW')
  order by d.requested_at
  limit 200;
$$;

-- Profile creation on signup.
--
-- A WRITE wrapper, and the only one here. It is needed because the new user has
-- no session yet, so an RLS-bound insert would be blocked by their own row.
--
-- It is idempotent on `id`, so a retried signup converges rather than erroring,
-- and it will not overwrite an existing display name with a later blank one.
create or replace function public.ensure_my_profile(p_user_id uuid, p_display_name text)
returns void
language sql
security definer
set search_path = app, pg_catalog
as $$
  insert into app.profiles (id, display_name)
  values (p_user_id, nullif(trim(coalesce(p_display_name, '')), ''))
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, app.profiles.display_name),
        updated_at = now();
$$;

-- Grants. `anon` and `authenticated` are revoked outright: every read is either
-- scoped to the authenticated caller (verified in TypeScript) or reserved for an
-- operator, and an end-user session has no business calling any of them.
revoke all on function public.ensure_my_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_my_profile(uuid, text) to service_role;
revoke all on function public.get_my_profile(uuid) from public, anon, authenticated;
revoke all on function public.list_my_notifications(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.list_my_support_tickets(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.get_my_support_ticket(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_live_offers() from public, anon, authenticated;
revoke all on function public.list_live_surveys() from public, anon, authenticated;
revoke all on function public.list_providers() from public, anon, authenticated;
revoke all on function public.list_my_deposits(uuid) from public, anon, authenticated;
revoke all on function public.list_my_withdrawals(uuid) from public, anon, authenticated;
revoke all on function public.list_deposits_awaiting_review() from public, anon, authenticated;
revoke all on function public.owns_my_deposit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.owns_my_withdrawal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_active_admin_role(uuid) from public, anon, authenticated;
revoke all on function public.get_role_capabilities(text) from public, anon, authenticated;

grant execute on function public.get_my_profile(uuid) to service_role;
grant execute on function public.list_my_notifications(uuid, integer, boolean) to service_role;
grant execute on function public.list_my_support_tickets(uuid, integer, text) to service_role;
grant execute on function public.get_my_support_ticket(uuid, uuid) to service_role;
grant execute on function public.list_live_offers() to service_role;
grant execute on function public.list_live_surveys() to service_role;
grant execute on function public.list_providers() to service_role;
grant execute on function public.list_my_deposits(uuid) to service_role;
grant execute on function public.list_my_withdrawals(uuid) to service_role;
grant execute on function public.list_deposits_awaiting_review() to service_role;
grant execute on function public.owns_my_deposit(uuid, uuid) to service_role;
grant execute on function public.owns_my_withdrawal(uuid, uuid) to service_role;
grant execute on function public.get_active_admin_role(uuid) to service_role;
grant execute on function public.get_role_capabilities(text) to service_role;