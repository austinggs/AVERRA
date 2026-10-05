-- =============================================================================
-- Averra migration 058: Public entry points for the reversal commands
--
-- Source of truth: 08_PROVIDER_INTEGRATION.txt, 71_ARCHITECTURAL_LAWS.md
--                  (laws 4, 5, 12, 20)
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- Migration 035 exists because PostgREST can only resolve an RPC against an EXPOSED
-- schema. `app_private` is not exposed, so every `app_private` command has a thin
-- `public` wrapper, and that wrapper - not the private function - is what
-- `src/lib/providers/ingest.ts` actually calls.
--
-- Migration 057 added two app_private commands. Without wrappers here they are
-- unreachable from the callback path, so every reversal would arrive, verify, normalize
-- and then have nowhere to go.
--
-- `get_original_conversion_for_reversal` is NOT wrapped here. Migration 057 defines it
-- directly in `public`, because a narrow read wrapper belongs in the exposed schema and
-- has no privileged body worth hiding. Wrapping it again was tried and removed: it
-- produced a `public` function calling an `app_private` one that does not exist.
--
-- NOTHING HERE IS NEW LOGIC
--
-- Both wrappers are single-statement forwarders. The application functions live in
-- app_private and are the thing worth reviewing; these exist so a service_role client
-- can reach them at all.
--
-- EVERY WRAPPER REVOKES BEFORE IT GRANTS, because a function in `public` is born
-- executable by an unauthenticated caller (see AGENTS.md, and migration 036, which
-- closed the same hole across 29 wrappers).
-- =============================================================================

-- Forwarding wrapper for the reversal command.
--
-- The outcome distinction matters to the caller: `reversed` means money moved, and
-- `no_reward` means there was nothing to move. Both are successes, and both are returned
-- rather than raised, so a genuine failure is the only thing that reaches the error path
-- in ingest.ts.
create or replace function public.apply_provider_reversal(
  p_reversal_conversion_id uuid,
  p_reason_code text,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_correlation_id uuid DEFAULT NULL::uuid
)
returns jsonb
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.apply_provider_reversal(
    p_reversal_conversion_id, p_reason_code, p_actor_id, p_correlation_id
  );
$$;

revoke all on function public.apply_provider_reversal(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_provider_reversal(uuid, text, uuid, uuid)
  to service_role;

comment on function public.apply_provider_reversal(uuid, text, uuid, uuid) is
  'Applies a recorded provider reversal. Returns {"outcome": "reversed" | "no_reward", '
  '"originalId": uuid, ...}. Revokes money through reverse_conversion, never by deleting '
  'the original reward (law 7).';


-- Forwarding wrapper for recording a reversal.
--
-- Separate from the existing `public.record_provider_conversion` on purpose. That
-- wrapper and migration 034's function are left exactly as they were, so the ordinary
-- completion path keeps its reviewed signature and law 5's guarantee is untouched. The
-- first attempt added a parameter to both instead, and `check:migrations` correctly
-- refused: the 14-argument positional call would have compiled and then failed at
-- runtime.
--
-- `matched` comes back false when no original conversion exists for the withdrawn
-- transaction. That is a recorded, expected outcome - a vendor may withdraw something we
-- never received - and never an error.
create or replace function public.record_provider_reversal_conversion(
  p_provider_id uuid,
  p_provider_event_id text,
  p_reverses_event_id text,
  p_source_type text,
  p_event_type text,
  p_callback_id bigint DEFAULT NULL::bigint,
  p_campaign_ref text DEFAULT NULL::text,
  p_currency text DEFAULT NULL::text,
  p_gross_value_minor bigint DEFAULT NULL::bigint,
  p_event_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_normalized_payload jsonb DEFAULT '{}'::jsonb,
  p_correlation_id uuid DEFAULT NULL::uuid
)
returns jsonb
language sql
security definer
set search_path = app, pg_catalog
as $$
  select app_private.record_provider_reversal_conversion(
    p_provider_id, p_provider_event_id, p_reverses_event_id, p_source_type,
    p_event_type, p_callback_id, p_campaign_ref, p_currency, p_gross_value_minor,
    p_event_timestamp, p_normalized_payload, p_correlation_id
  );
$$;

revoke all on function public.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) to service_role;

comment on function public.record_provider_reversal_conversion(
  uuid, text, text, text, text, bigint, text, text, bigint, timestamptz, jsonb, uuid
) is
  'Records a provider reversal, idempotent on the reversal event id. Returns '
  '{"id": uuid, "isDuplicate": boolean, "matched": boolean}. Records no reward and moves '
  'no money; apply_provider_reversal does that.';