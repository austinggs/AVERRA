-- =============================================================================
-- Averra migration 019: Mining Game authoritative commands
--
-- Source of truth: 20_MACHINES, 21_RESOURCES, 22_ENERGY, 23_INVENTORY,
--                  31_SERVER_AUTHORITY, 32_ANTI_ABUSE, law 25 and law 26
--
-- Doc 31 REQUEST VALIDATION, implemented literally:
--   "Authenticate user, validate action ID/idempotency, load current state,
--    check prerequisites, apply atomic transition, emit event, return
--    authoritative state/version."
--
-- EVERY game mutation goes through these functions. There is no other path. The
-- client cannot write a game table: RLS is enabled, the browser roles hold no
-- grant, and these functions are the only executors.
--
-- NOTHING HERE TOUCHES MONEY. No function in this migration calls
-- `grant_reward`, `post_ledger_entry` or any ledger primitive (law 26).
-- =============================================================================

-- Doc 31 CONCURRENCY. Every action presents the version it was based on. A
-- mismatch means the world moved underneath the client, so the action is
-- refused rather than applied to stale state.
create or replace function app_private.assert_game_version(
  p_user_id uuid,
  p_expected_version bigint
) returns app.game_players
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_player app.game_players;
begin
  select * into v_player from app.game_players where user_id = p_user_id for update;
  if not found then
    raise exception 'assert_game_version: no game player for user'
      using errcode = 'foreign_key_violation';
  end if;

  if p_expected_version is not null and v_player.state_version <> p_expected_version then
    raise exception 'assert_game_version: state version is %, client presented %',
      v_player.state_version, p_expected_version using errcode = 'serialization_failure';
  end if;

  return v_player;
end;
$$;

-- Doc 22 SERVER AUTHORITY: energy is computed from server time. A client
-- countdown is presentation only and is never read.
create or replace function app_private.regenerate_energy(p_user_id uuid)
returns app.game_players
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_player app.game_players;
  v_elapsed_minutes numeric;
  v_regenerated integer;
begin
  select * into v_player from app.game_players where user_id = p_user_id for update;
  if not found then
    raise exception 'regenerate_energy: no game player for user'
      using errcode = 'foreign_key_violation';
  end if;

  -- Clock arithmetic is clamped at zero: a backwards clock must not remove
  -- energy, because that would let a client drain a regeneration window.
  v_elapsed_minutes := greatest(
    0,
    extract(epoch from (now() - v_player.energy_last_calculated_at)) / 60.0
  );

  v_regenerated := least(
    v_player.energy_max - v_player.energy_current,
    floor(v_elapsed_minutes * v_player.energy_regen_per_minute)::integer
  );

  -- The watermark advances in BOTH branches. If it only advanced on a gain, a
  -- later spend would compute regeneration from a stale starting point and grant
  -- a windfall.
  update app.game_players
  set energy_current = energy_current + greatest(v_regenerated, 0),
      energy_last_calculated_at = now()
  where user_id = p_user_id
  returning * into v_player;

  return v_player;
end;
$$;

-- Doc 20 SERVER AUTHORITY: start/stop/collect are validated server-side.
create or replace function app_private.perform_game_action(
  p_user_id uuid,
  p_action text,
  p_machine_id uuid default null,
  p_action_id text default null,
  p_expected_version bigint default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_player app.game_players;
  v_machine app.game_machines;
  v_type app.game_machine_types;
  v_from_version bigint;
  v_elapsed integer;
  v_ticks integer;
  v_amount bigint;
  v_resource_id uuid;
begin
  if p_action not in ('START','STOP','COLLECT') then
    raise exception 'perform_game_action: unknown action %', p_action
      using errcode = 'invalid_parameter_value';
  end if;

  -- Doc 31: validate idempotency BEFORE applying anything, so a retried action
  -- is a no-op rather than a second production tick or a second energy spend.
  if p_action_id is not null and
     exists (select 1 from app.game_events where action_id = p_action_id) then
    return jsonb_build_object(
      'replayed', true,
      'action', p_action,
      'stateVersion', (select state_version from app.game_players where user_id = p_user_id)
    );
  end if;

  v_player := app_private.assert_game_version(p_user_id, p_expected_version);
  v_player := app_private.regenerate_energy(p_user_id);
  v_from_version := v_player.state_version;

  select * into v_machine
  from app.game_machines
  where id = p_machine_id and owner_user_id = p_user_id
  for update;

  if not found then
    raise exception 'perform_game_action: unknown machine for this user'
      using errcode = 'foreign_key_violation';
  end if;

  select * into v_type from app.game_machine_types where id = v_machine.machine_type_id;

if p_action = 'START' then
    if v_machine.state <> 'IDLE' then
      raise exception 'perform_game_action: machine is %, cannot start', v_machine.state
        using errcode = 'check_violation';
    end if;

    -- Doc 22 CONSUMPTION: sufficient energy is validated atomically with the
    -- action, never on the client's say-so.
    if v_player.energy_current < v_type.energy_cost then
      raise exception 'perform_game_action: insufficient energy (% of % required)',
        v_player.energy_current, v_type.energy_cost using errcode = 'check_violation';
    end if;

    update app.game_players
    set energy_current = energy_current - v_type.energy_cost,
        state_version = state_version + 1
    where user_id = p_user_id;

    update app.game_machines
    set state = 'RUNNING', last_produced_at = now(), state_version = state_version + 1
    where id = p_machine_id;

  elsif p_action = 'STOP' then
    if v_machine.state <> 'RUNNING' then
      raise exception 'perform_game_action: machine is %, cannot stop', v_machine.state
        using errcode = 'check_violation';
    end if;

    update app.game_machines
    set state = 'IDLE', state_version = state_version + 1
    where id = p_machine_id;

    update app.game_players set state_version = state_version + 1 where user_id = p_user_id;

  else
    -- COLLECT. Doc 20 PRODUCTION: the server computes output from authoritative
    -- elapsed time. This function accepts no client-supplied quantity, so there
    -- is no amount for a client to forge.
    if v_machine.state <> 'RUNNING' then
      raise exception 'perform_game_action: machine is not running'
        using errcode = 'check_violation';
    end if;

    v_elapsed := greatest(0, extract(epoch from (now() - v_machine.last_produced_at))::integer);
    v_ticks := v_elapsed / v_type.production_interval_seconds;

    if v_ticks <= 0 then
      raise exception 'perform_game_action: nothing produced yet'
        using errcode = 'check_violation';
    end if;

    -- Level scales output; condition scales it down. Both are server data.
    v_amount := (v_type.base_output_minor * v_ticks * v_machine.level)
                * greatest(0, v_machine.condition);

    if v_amount <= 0 then
      raise exception 'perform_game_action: production is zero'
        using errcode = 'check_violation';
    end if;

    select id into v_resource_id from app.game_resources where code = 'ore_basic';
    if v_resource_id is null then
      raise exception 'perform_game_action: no resource definition for %', v_type.code
        using errcode = 'check_violation';
    end if;

    insert into app.game_inventory (user_id, resource_id, quantity)
    values (p_user_id, v_resource_id, v_amount)
    on conflict (user_id, resource_id) do update
      set quantity = app.game_inventory.quantity + excluded.quantity,
          updated_at = now();

    -- Advance the clock by whole ticks only, so fractional progress is not lost
    -- and a client cannot farm a partial tick by collecting repeatedly.
    update app.game_machines
    set last_produced_at = last_produced_at
          + (v_ticks * v_type.production_interval_seconds) * interval '1 second',
        state_version = state_version + 1
    where id = p_machine_id;

    update app.game_players set state_version = state_version + 1 where user_id = p_user_id;
  end if;

  -- Doc 31 OBSERVABILITY: the event is emitted in the SAME transaction as the
  -- state change, so an action and its evidence cannot diverge.
  insert into app.game_events (
    user_id, machine_id, event_type, action_id, from_version, to_version, payload, client_ip
  ) values (
    p_user_id, p_machine_id, p_action, p_action_id, v_from_version, v_from_version + 1,
    jsonb_build_object('correlationId', p_correlation_id, 'action', p_action), p_client_ip
  );

  return jsonb_build_object(
    'replayed', false,
    'action', p_action,
    'machineId', p_machine_id,
    'machineState', (select state from app.game_machines where id = p_machine_id),
    'energy', (select energy_current from app.game_players where user_id = p_user_id),
    'stateVersion', (select state_version from app.game_players where user_id = p_user_id)
  );
end;
$$;

revoke all on function app_private.assert_game_version(uuid, bigint) from public, anon, authenticated;
revoke all on function app_private.regenerate_energy(uuid) from public, anon, authenticated;
revoke all on function app_private.perform_game_action(uuid, text, uuid, text, bigint, inet, uuid) from public, anon, authenticated;

grant execute on function app_private.assert_game_version(uuid, bigint) to service_role;
grant execute on function app_private.regenerate_energy(uuid) to service_role;
grant execute on function app_private.perform_game_action(uuid, text, uuid, text, bigint, inet, uuid) to service_role;