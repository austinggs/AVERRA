-- =============================================================================
-- Averra migration 035: public entry points for the app_private commands
--
-- Closes the defect recorded as Q-21 in docs/DISCREPANCIES.md.
--
-- The platform could not WRITE anything. 26 of 51 RPC call sites returned
-- PGRST202 because PostgREST resolves .rpc() only against EXPOSED schemas,
-- and every command lived in app_private with no public entry point.
--
-- Why not simply expose app_private? Because that would publish every
-- internal function to PostgREST at once, including grant_reward,
-- post_ledger_entry, rebuild_account_balances, reverse_reward and
-- assert_distinct_approver. Those are meant to be reachable only from inside
-- another function's body. Exposing the schema turns deliberate privilege
-- boundaries into an accident of configuration, which is precisely the
-- failure AGENTS.md forbids for app. app_private stays hidden.
--
-- Each wrapper below is a thin, same-signature SECURITY DEFINER delegate to
-- its app_private command, granted to service_role only. It adds no logic and
-- makes no decision. The command remains the authority; the wrapper exists
-- only so PostgREST can reach it. This is the pattern already used by
-- public.get_my_deposit (032) and public.resolve_tracking_user (034).
--
-- Signatures below are copied verbatim from the live catalog, not retyped.
--
-- The two void-returning commands use plpgsql so that they can PERFORM the
-- call rather than SELECT it; a language sql wrapper returning void would
-- return a single void column instead of nothing.
--
-- get_task is new, not a wrapper. It did not exist in ANY schema and was
-- called from two places. It mirrors list_live_tasks but is NOT restricted to
-- LIVE tasks, so a paused or retired task still renders with an explanation
-- instead of a 404.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Deposit request lifecycle.
--
-- The chain of custody to money. A SUBMITTED deposit is not a confirmed deposit and neither is a reward.
-- -----------------------------------------------------------------------------

-- Human authorisation that credits the User Funding Balance. Never an earned reward.
create or replace function public.confirm_deposit(p_deposit_id uuid, p_approver_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.deposit_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.confirm_deposit(p_deposit_id, p_approver_id, p_idempotency_key, p_reason, p_correlation_id);
$$;

revoke all on function public.confirm_deposit(p_deposit_id uuid, p_approver_id uuid, p_idempotency_key text, p_reason text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.confirm_deposit(p_deposit_id uuid, p_approver_id uuid, p_idempotency_key text, p_reason text, p_correlation_id uuid) to service_role;

comment on function public.confirm_deposit(p_deposit_id uuid, p_approver_id uuid, p_idempotency_key text, p_reason text, p_correlation_id uuid) is 'Human authorisation that credits the User Funding Balance. Never an earned reward.';

-- Creates a PENDING deposit request. Records an intention to pay; moves no money.
create or replace function public.create_deposit_request(p_user_id uuid, p_declared_symbol text, p_declared_amount_minor bigint, p_sender_address text DEFAULT NULL::text, p_ttl_hours integer DEFAULT 24)
returns app.deposit_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.create_deposit_request(p_user_id, p_declared_symbol, p_declared_amount_minor, p_sender_address, p_ttl_hours);
$$;

revoke all on function public.create_deposit_request(p_user_id uuid, p_declared_symbol text, p_declared_amount_minor bigint, p_sender_address text, p_ttl_hours integer) from public, anon, authenticated;
grant execute on function public.create_deposit_request(p_user_id uuid, p_declared_symbol text, p_declared_amount_minor bigint, p_sender_address text, p_ttl_hours integer) to service_role;

comment on function public.create_deposit_request(p_user_id uuid, p_declared_symbol text, p_declared_amount_minor bigint, p_sender_address text, p_ttl_hours integer) is 'Creates a PENDING deposit request. Records an intention to pay; moves no money.';

-- Rejects a deposit request. A compensating decision, never a deletion.
create or replace function public.reject_deposit(p_deposit_id uuid, p_actor_id uuid, p_reason text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.deposit_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.reject_deposit(p_deposit_id, p_actor_id, p_reason, p_correlation_id);
$$;

revoke all on function public.reject_deposit(p_deposit_id uuid, p_actor_id uuid, p_reason text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.reject_deposit(p_deposit_id uuid, p_actor_id uuid, p_reason text, p_correlation_id uuid) to service_role;

comment on function public.reject_deposit(p_deposit_id uuid, p_actor_id uuid, p_reason text, p_correlation_id uuid) is 'Rejects a deposit request. A compensating decision, never a deletion.';

-- Records the user's transaction hash against their own PENDING request, with its audit event in one transaction.
create or replace function public.submit_deposit_tx(p_user_id uuid, p_deposit_id uuid, p_tx_hash text, p_screenshot_reference text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.deposit_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.submit_deposit_tx(p_user_id, p_deposit_id, p_tx_hash, p_screenshot_reference, p_correlation_id);
$$;

revoke all on function public.submit_deposit_tx(p_user_id uuid, p_deposit_id uuid, p_tx_hash text, p_screenshot_reference text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.submit_deposit_tx(p_user_id uuid, p_deposit_id uuid, p_tx_hash text, p_screenshot_reference text, p_correlation_id uuid) to service_role;

comment on function public.submit_deposit_tx(p_user_id uuid, p_deposit_id uuid, p_tx_hash text, p_screenshot_reference text, p_correlation_id uuid) is 'Records the user''s transaction hash against their own PENDING request, with its audit event in one transaction.';

-- -----------------------------------------------------------------------------
-- Withdrawal request creation.
--
-- Requests only. Settlement is a separate, later, human or automated decision.
-- -----------------------------------------------------------------------------

-- Creates a PENDING withdrawal request. Moves no money.
create or replace function public.create_withdrawal_request(p_user_id uuid, p_method text, p_destination_id uuid, p_gross_minor bigint, p_unit text, p_idempotency_key text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.withdrawal_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.create_withdrawal_request(p_user_id, p_method, p_destination_id, p_gross_minor, p_unit, p_idempotency_key, p_correlation_id);
$$;

revoke all on function public.create_withdrawal_request(p_user_id uuid, p_method text, p_destination_id uuid, p_gross_minor bigint, p_unit text, p_idempotency_key text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.create_withdrawal_request(p_user_id uuid, p_method text, p_destination_id uuid, p_gross_minor bigint, p_unit text, p_idempotency_key text, p_correlation_id uuid) to service_role;

comment on function public.create_withdrawal_request(p_user_id uuid, p_method text, p_destination_id uuid, p_gross_minor bigint, p_unit text, p_idempotency_key text, p_correlation_id uuid) is 'Creates a PENDING withdrawal request. Moves no money.';

-- -----------------------------------------------------------------------------
-- Task attempt and completion evidence.
--
-- submit_task_completion has no path to money. The reward is created only by verify_task_completion inside the attempt transaction.
-- -----------------------------------------------------------------------------

-- Records a task-start signal for the fraud detectors.
create or replace function public.record_task_signal(p_user_id uuid, p_device_fingerprint text DEFAULT NULL::text, p_client_ip inet DEFAULT NULL::inet, p_correlation_id uuid DEFAULT NULL::uuid)
returns integer
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.record_task_signal(p_user_id, p_device_fingerprint, p_client_ip, p_correlation_id);
$$;

revoke all on function public.record_task_signal(p_user_id uuid, p_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.record_task_signal(p_user_id uuid, p_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) to service_role;

comment on function public.record_task_signal(p_user_id uuid, p_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) is 'Records a task-start signal for the fraud detectors.';

-- Opens a task attempt. Re-validates task state, availability window and the attempt cap.
create or replace function public.start_task_attempt(p_user_id uuid, p_task_id uuid, p_client_device_fingerprint text DEFAULT NULL::text, p_client_ip inet DEFAULT NULL::inet, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.task_attempts
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.start_task_attempt(p_user_id, p_task_id, p_client_device_fingerprint, p_client_ip, p_correlation_id);
$$;

revoke all on function public.start_task_attempt(p_user_id uuid, p_task_id uuid, p_client_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.start_task_attempt(p_user_id uuid, p_task_id uuid, p_client_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) to service_role;

comment on function public.start_task_attempt(p_user_id uuid, p_task_id uuid, p_client_device_fingerprint text, p_client_ip inet, p_correlation_id uuid) is 'Opens a task attempt. Re-validates task state, availability window and the attempt cap.';

-- Records client completion EVIDENCE and sets SUBMITTED. Has no path to money by construction.
create or replace function public.submit_task_completion(p_attempt_id uuid, p_user_id uuid, p_client_claim jsonb DEFAULT '{}'::jsonb, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.task_attempts
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.submit_task_completion(p_attempt_id, p_user_id, p_client_claim, p_correlation_id);
$$;

revoke all on function public.submit_task_completion(p_attempt_id uuid, p_user_id uuid, p_client_claim jsonb, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.submit_task_completion(p_attempt_id uuid, p_user_id uuid, p_client_claim jsonb, p_correlation_id uuid) to service_role;

comment on function public.submit_task_completion(p_attempt_id uuid, p_user_id uuid, p_client_claim jsonb, p_correlation_id uuid) is 'Records client completion EVIDENCE and sets SUBMITTED. Has no path to money by construction.';

-- -----------------------------------------------------------------------------
-- Provider callback evidence and conversion.
--
-- This is the surface CR-0013 was raised to close. Before it existed, no provider callback evidence was ever recorded (Q-13).
-- -----------------------------------------------------------------------------

-- Applies the reward for a settled conversion through the risk-gated grant path.
create or replace function public.apply_conversion_reward(p_conversion_id uuid, p_source_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.rewards
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.apply_conversion_reward(p_conversion_id, p_source_id, p_correlation_id);
$$;

revoke all on function public.apply_conversion_reward(p_conversion_id uuid, p_source_id uuid, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.apply_conversion_reward(p_conversion_id uuid, p_source_id uuid, p_correlation_id uuid) to service_role;

comment on function public.apply_conversion_reward(p_conversion_id uuid, p_source_id uuid, p_correlation_id uuid) is 'Applies the reward for a settled conversion through the risk-gated grant path.';

-- Records the processing outcome of a previously recorded callback. A new row, never an edit.
create or replace function public.record_callback_outcome(p_callback_id bigint, p_processing_result text, p_reason_code text DEFAULT NULL::text, p_conversion_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  perform app_private.record_callback_outcome(p_callback_id, p_processing_result, p_reason_code, p_conversion_id, p_correlation_id);
end;
$$;

revoke all on function public.record_callback_outcome(p_callback_id bigint, p_processing_result text, p_reason_code text, p_conversion_id uuid, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.record_callback_outcome(p_callback_id bigint, p_processing_result text, p_reason_code text, p_conversion_id uuid, p_correlation_id uuid) to service_role;

comment on function public.record_callback_outcome(p_callback_id bigint, p_processing_result text, p_reason_code text, p_conversion_id uuid, p_correlation_id uuid) is 'Records the processing outcome of a previously recorded callback. A new row, never an edit.';

-- Records immutable evidence of what a provider actually sent. Append-only.
create or replace function public.record_provider_callback(p_provider_id uuid, p_remote_address text DEFAULT NULL::text, p_signature_present boolean DEFAULT false, p_signature_algorithm text DEFAULT NULL::text, p_verification_result text DEFAULT 'ABSENT'::text, p_verification_reason text DEFAULT NULL::text, p_claimed_event_id text DEFAULT NULL::text, p_claimed_event_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_raw_payload jsonb DEFAULT '{}'::jsonb, p_payload_hash text DEFAULT NULL::text, p_headers jsonb DEFAULT '{}'::jsonb, p_correlation_id uuid DEFAULT NULL::uuid)
returns bigint
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.record_provider_callback(p_provider_id, p_remote_address, p_signature_present, p_signature_algorithm, p_verification_result, p_verification_reason, p_claimed_event_id, p_claimed_event_timestamp, p_raw_payload, p_payload_hash, p_headers, p_correlation_id);
$$;

revoke all on function public.record_provider_callback(p_provider_id uuid, p_remote_address text, p_signature_present boolean, p_signature_algorithm text, p_verification_result text, p_verification_reason text, p_claimed_event_id text, p_claimed_event_timestamp timestamp with time zone, p_raw_payload jsonb, p_payload_hash text, p_headers jsonb, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.record_provider_callback(p_provider_id uuid, p_remote_address text, p_signature_present boolean, p_signature_algorithm text, p_verification_result text, p_verification_reason text, p_claimed_event_id text, p_claimed_event_timestamp timestamp with time zone, p_raw_payload jsonb, p_payload_hash text, p_headers jsonb, p_correlation_id uuid) to service_role;

comment on function public.record_provider_callback(p_provider_id uuid, p_remote_address text, p_signature_present boolean, p_signature_algorithm text, p_verification_result text, p_verification_reason text, p_claimed_event_id text, p_claimed_event_timestamp timestamp with time zone, p_raw_payload jsonb, p_payload_hash text, p_headers jsonb, p_correlation_id uuid) is 'Records immutable evidence of what a provider actually sent. Append-only.';

-- Records a provider conversion event, idempotent on the provider event id.
create or replace function public.record_provider_conversion(p_provider_id uuid, p_provider_event_id text, p_source_type text, p_event_type text, p_callback_id bigint DEFAULT NULL::bigint, p_campaign_ref text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_tracking_id text DEFAULT NULL::text, p_status text DEFAULT 'RECEIVED'::text, p_gross_value_minor bigint DEFAULT NULL::bigint, p_currency text DEFAULT NULL::text, p_event_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_normalized_payload jsonb DEFAULT '{}'::jsonb, p_correlation_id uuid DEFAULT NULL::uuid)
returns jsonb
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.record_provider_conversion(p_provider_id, p_provider_event_id, p_source_type, p_event_type, p_callback_id, p_campaign_ref, p_user_id, p_tracking_id, p_status, p_gross_value_minor, p_currency, p_event_timestamp, p_normalized_payload, p_correlation_id);
$$;

revoke all on function public.record_provider_conversion(p_provider_id uuid, p_provider_event_id text, p_source_type text, p_event_type text, p_callback_id bigint, p_campaign_ref text, p_user_id uuid, p_tracking_id text, p_status text, p_gross_value_minor bigint, p_currency text, p_event_timestamp timestamp with time zone, p_normalized_payload jsonb, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.record_provider_conversion(p_provider_id uuid, p_provider_event_id text, p_source_type text, p_event_type text, p_callback_id bigint, p_campaign_ref text, p_user_id uuid, p_tracking_id text, p_status text, p_gross_value_minor bigint, p_currency text, p_event_timestamp timestamp with time zone, p_normalized_payload jsonb, p_correlation_id uuid) to service_role;

comment on function public.record_provider_conversion(p_provider_id uuid, p_provider_event_id text, p_source_type text, p_event_type text, p_callback_id bigint, p_campaign_ref text, p_user_id uuid, p_tracking_id text, p_status text, p_gross_value_minor bigint, p_currency text, p_event_timestamp timestamp with time zone, p_normalized_payload jsonb, p_correlation_id uuid) is 'Records a provider conversion event, idempotent on the provider event id.';

-- -----------------------------------------------------------------------------
-- Mining Game commands.
--
-- Game resources are not money. None of these can credit an Earned Reward Balance.
-- -----------------------------------------------------------------------------

-- Claims a completed mission. Game resources only.
create or replace function public.claim_mission(p_user_id uuid, p_mission_code text, p_action_id text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.game_mission_progress
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.claim_mission(p_user_id, p_mission_code, p_action_id, p_correlation_id);
$$;

revoke all on function public.claim_mission(p_user_id uuid, p_mission_code text, p_action_id text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.claim_mission(p_user_id uuid, p_mission_code text, p_action_id text, p_correlation_id uuid) to service_role;

comment on function public.claim_mission(p_user_id uuid, p_mission_code text, p_action_id text, p_correlation_id uuid) is 'Claims a completed mission. Game resources only.';

-- Deploys a game machine. Game resources only.
create or replace function public.deploy_machine(p_user_id uuid, p_machine_type_code text, p_location_slot integer DEFAULT NULL::integer, p_action_id text DEFAULT NULL::text, p_client_ip inet DEFAULT NULL::inet, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.game_machines
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.deploy_machine(p_user_id, p_machine_type_code, p_location_slot, p_action_id, p_client_ip, p_correlation_id);
$$;

revoke all on function public.deploy_machine(p_user_id uuid, p_machine_type_code text, p_location_slot integer, p_action_id text, p_client_ip inet, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.deploy_machine(p_user_id uuid, p_machine_type_code text, p_location_slot integer, p_action_id text, p_client_ip inet, p_correlation_id uuid) to service_role;

comment on function public.deploy_machine(p_user_id uuid, p_machine_type_code text, p_location_slot integer, p_action_id text, p_client_ip inet, p_correlation_id uuid) is 'Deploys a game machine. Game resources only.';

-- Performs a version-checked game action. Game resources only.
create or replace function public.perform_game_action(p_user_id uuid, p_action text, p_machine_id uuid DEFAULT NULL::uuid, p_action_id text DEFAULT NULL::text, p_expected_version bigint DEFAULT NULL::bigint, p_client_ip inet DEFAULT NULL::inet, p_correlation_id uuid DEFAULT NULL::uuid)
returns jsonb
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.perform_game_action(p_user_id, p_action, p_machine_id, p_action_id, p_expected_version, p_client_ip, p_correlation_id);
$$;

revoke all on function public.perform_game_action(p_user_id uuid, p_action text, p_machine_id uuid, p_action_id text, p_expected_version bigint, p_client_ip inet, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.perform_game_action(p_user_id uuid, p_action text, p_machine_id uuid, p_action_id text, p_expected_version bigint, p_client_ip inet, p_correlation_id uuid) to service_role;

comment on function public.perform_game_action(p_user_id uuid, p_action text, p_machine_id uuid, p_action_id text, p_expected_version bigint, p_client_ip inet, p_correlation_id uuid) is 'Performs a version-checked game action. Game resources only.';

-- Requests a machine upgrade. Game resources only.
create or replace function public.request_machine_upgrade(p_user_id uuid, p_machine_id uuid, p_upgrade_code text, p_action_id text DEFAULT NULL::text, p_client_ip inet DEFAULT NULL::inet, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.game_upgrade_requests
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.request_machine_upgrade(p_user_id, p_machine_id, p_upgrade_code, p_action_id, p_client_ip, p_correlation_id);
$$;

revoke all on function public.request_machine_upgrade(p_user_id uuid, p_machine_id uuid, p_upgrade_code text, p_action_id text, p_client_ip inet, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.request_machine_upgrade(p_user_id uuid, p_machine_id uuid, p_upgrade_code text, p_action_id text, p_client_ip inet, p_correlation_id uuid) to service_role;

comment on function public.request_machine_upgrade(p_user_id uuid, p_machine_id uuid, p_upgrade_code text, p_action_id text, p_client_ip inet, p_correlation_id uuid) is 'Requests a machine upgrade. Game resources only.';

-- -----------------------------------------------------------------------------
-- Support tickets and replies.
--
-- Replies here are authored by humans only. There is deliberately no AI reply command.
-- -----------------------------------------------------------------------------

-- Opens a support ticket.
create or replace function public.create_support_ticket(p_user_id uuid, p_subject text, p_body text, p_category text DEFAULT 'Other'::text, p_linked_deposit_id uuid DEFAULT NULL::uuid, p_linked_withdrawal_id uuid DEFAULT NULL::uuid, p_linked_ledger_entry_id bigint DEFAULT NULL::bigint, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.support_tickets
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.create_support_ticket(p_user_id, p_subject, p_body, p_category, p_linked_deposit_id, p_linked_withdrawal_id, p_linked_ledger_entry_id, p_correlation_id);
$$;

revoke all on function public.create_support_ticket(p_user_id uuid, p_subject text, p_body text, p_category text, p_linked_deposit_id uuid, p_linked_withdrawal_id uuid, p_linked_ledger_entry_id bigint, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.create_support_ticket(p_user_id uuid, p_subject text, p_body text, p_category text, p_linked_deposit_id uuid, p_linked_withdrawal_id uuid, p_linked_ledger_entry_id bigint, p_correlation_id uuid) to service_role;

comment on function public.create_support_ticket(p_user_id uuid, p_subject text, p_body text, p_category text, p_linked_deposit_id uuid, p_linked_withdrawal_id uuid, p_linked_ledger_entry_id bigint, p_correlation_id uuid) is 'Opens a support ticket.';

-- Appends a HUMAN agent reply. There is no AI-authored reply path.
create or replace function public.post_agent_reply(p_ticket_id uuid, p_agent_id uuid, p_body text, p_set_status text DEFAULT NULL::text, p_attachment_refs jsonb DEFAULT '[]'::jsonb, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.support_tickets
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.post_agent_reply(p_ticket_id, p_agent_id, p_body, p_set_status, p_attachment_refs, p_correlation_id);
$$;

revoke all on function public.post_agent_reply(p_ticket_id uuid, p_agent_id uuid, p_body text, p_set_status text, p_attachment_refs jsonb, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.post_agent_reply(p_ticket_id uuid, p_agent_id uuid, p_body text, p_set_status text, p_attachment_refs jsonb, p_correlation_id uuid) to service_role;

comment on function public.post_agent_reply(p_ticket_id uuid, p_agent_id uuid, p_body text, p_set_status text, p_attachment_refs jsonb, p_correlation_id uuid) is 'Appends a HUMAN agent reply. There is no AI-authored reply path.';

-- Appends a user reply to a support ticket.
create or replace function public.post_user_reply(p_ticket_id uuid, p_user_id uuid, p_body text)
returns app.support_tickets
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.post_user_reply(p_ticket_id, p_user_id, p_body);
$$;

revoke all on function public.post_user_reply(p_ticket_id uuid, p_user_id uuid, p_body text) from public, anon, authenticated;
grant execute on function public.post_user_reply(p_ticket_id uuid, p_user_id uuid, p_body text) to service_role;

comment on function public.post_user_reply(p_ticket_id uuid, p_user_id uuid, p_body text) is 'Appends a user reply to a support ticket.';

-- -----------------------------------------------------------------------------
-- Transactional outbox claim and completion.
--
-- The outbox is written in the same transaction as every state change. Without these four it has no consumer.
-- -----------------------------------------------------------------------------

-- Atomically leases a batch of pending outbox events to one worker.
create or replace function public.claim_outbox_events(p_worker_id text, p_limit integer DEFAULT 25, p_lease_seconds integer DEFAULT 60)
returns SETOF app.outbox_events
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.claim_outbox_events(p_worker_id, p_limit, p_lease_seconds);
$$;

revoke all on function public.claim_outbox_events(p_worker_id text, p_limit integer, p_lease_seconds integer) from public, anon, authenticated;
grant execute on function public.claim_outbox_events(p_worker_id text, p_limit integer, p_lease_seconds integer) to service_role;

comment on function public.claim_outbox_events(p_worker_id text, p_limit integer, p_lease_seconds integer) is 'Atomically leases a batch of pending outbox events to one worker.';

-- Marks a leased outbox event as successfully processed.
create or replace function public.complete_outbox_event(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  perform app_private.complete_outbox_event(p_event_id);
end;
$$;

revoke all on function public.complete_outbox_event(p_event_id bigint) from public, anon, authenticated;
grant execute on function public.complete_outbox_event(p_event_id bigint) to service_role;

comment on function public.complete_outbox_event(p_event_id bigint) is 'Marks a leased outbox event as successfully processed.';

-- Records a processing failure and applies the retry or DEAD policy.
create or replace function public.fail_outbox_event(p_event_id bigint, p_error text, p_max_attempts integer DEFAULT 5)
returns app.outbox_status
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.fail_outbox_event(p_event_id, p_error, p_max_attempts);
$$;

revoke all on function public.fail_outbox_event(p_event_id bigint, p_error text, p_max_attempts integer) from public, anon, authenticated;
grant execute on function public.fail_outbox_event(p_event_id bigint, p_error text, p_max_attempts integer) to service_role;

comment on function public.fail_outbox_event(p_event_id bigint, p_error text, p_max_attempts integer) is 'Records a processing failure and applies the retry or DEAD policy.';

-- Current outbox counts by status. Operational read, service-role only.
create or replace function public.outbox_backlog()
returns TABLE(status app.outbox_status, event_count bigint)
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.outbox_backlog();
$$;

revoke all on function public.outbox_backlog() from public, anon, authenticated;
grant execute on function public.outbox_backlog() to service_role;

comment on function public.outbox_backlog() is 'Current outbox counts by status. Operational read, service-role only.';

-- -----------------------------------------------------------------------------
-- Notifications and referrals.
--
-- Low-risk state changes that still belong in a command rather than a client-side write.
-- -----------------------------------------------------------------------------

-- Attributes a referral to its referee. No money.
create or replace function public.attribute_referral(p_referee_user_id uuid, p_code text, p_correlation_id uuid DEFAULT NULL::uuid)
returns app.referrals
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.attribute_referral(p_referee_user_id, p_code, p_correlation_id);
$$;

revoke all on function public.attribute_referral(p_referee_user_id uuid, p_code text, p_correlation_id uuid) from public, anon, authenticated;
grant execute on function public.attribute_referral(p_referee_user_id uuid, p_code text, p_correlation_id uuid) to service_role;

comment on function public.attribute_referral(p_referee_user_id uuid, p_code text, p_correlation_id uuid) is 'Attributes a referral to its referee. No money.';

-- Creates a notification for a user.
create or replace function public.create_notification(p_user_id uuid, p_category app.notification_category, p_title text, p_body text, p_idempotency_key text, p_action_path text DEFAULT NULL::text, p_action_label text DEFAULT NULL::text, p_source_event_type text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text)
returns app.notifications
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.create_notification(p_user_id, p_category, p_title, p_body, p_idempotency_key, p_action_path, p_action_label, p_source_event_type, p_source_id);
$$;

revoke all on function public.create_notification(p_user_id uuid, p_category app.notification_category, p_title text, p_body text, p_idempotency_key text, p_action_path text, p_action_label text, p_source_event_type text, p_source_id text) from public, anon, authenticated;
grant execute on function public.create_notification(p_user_id uuid, p_category app.notification_category, p_title text, p_body text, p_idempotency_key text, p_action_path text, p_action_label text, p_source_event_type text, p_source_id text) to service_role;

comment on function public.create_notification(p_user_id uuid, p_category app.notification_category, p_title text, p_body text, p_idempotency_key text, p_action_path text, p_action_label text, p_source_event_type text, p_source_id text) is 'Creates a notification for a user.';

-- Marks one notification read, scoped to its owner.
create or replace function public.mark_notification_read(p_notification_id uuid, p_user_id uuid)
returns app.notifications
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.mark_notification_read(p_notification_id, p_user_id);
$$;

revoke all on function public.mark_notification_read(p_notification_id uuid, p_user_id uuid) from public, anon, authenticated;
grant execute on function public.mark_notification_read(p_notification_id uuid, p_user_id uuid) to service_role;

comment on function public.mark_notification_read(p_notification_id uuid, p_user_id uuid) is 'Marks one notification read, scoped to its owner.';

-- -----------------------------------------------------------------------------
-- get_task: one task definition by id, whatever its state.
--
-- This is a NEW read wrapper, not a command delegate. It existed in no schema
-- while two call sites already depended on it.
--
-- It deliberately does NOT filter on state. The task detail page must render a
-- PAUSED or RETIRED task with an explanation rather than a 404, so that
-- availability is communicated instead of inferred from a missing page.
-- Availability itself is decided by start_task_attempt inside the attempt
-- transaction; this read is presentation, never authorisation.
--
-- The jsonb key names match public.list_live_tasks exactly. A task must not
-- change shape depending on which function fetched it.
-- -----------------------------------------------------------------------------

create or replace function public.get_task(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, pg_catalog
as $$
  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'title', t.title,
    'description', t.description,
    'instructions', t.instructions,
    'state', t.state,
    'verificationMechanism', t.verification_mechanism,
    'autoVerify', t.auto_verify,
    'rewardAmountMinor', t.reward_amount_minor,
    'rewardUnit', t.reward_unit,
    'countries', t.countries,
    'minAccountAgeDays', t.min_account_age_days,
    'maxAttemptsPerUser', t.max_attempts_per_user,
    'minDurationSeconds', t.min_duration_seconds,
    'requiresProfileComplete', t.requires_profile_complete,
    'availableFrom', t.available_from,
    'availableUntil', t.available_until,
    'createdAt', t.created_at,
    'updatedAt', t.updated_at
  )
  from app.task_definitions t
  where t.id = p_task_id;
$$;

revoke all on function public.get_task(uuid) from public, anon, authenticated;
grant execute on function public.get_task(uuid) to service_role;

comment on function public.get_task(uuid) is
  'One task definition by id in any state, or NULL. Presentation only; start_task_attempt decides availability.';
