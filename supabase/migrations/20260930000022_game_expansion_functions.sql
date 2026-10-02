-- =============================================================================
-- Averra migration 022: Mining Game expansion commands
--
-- Source of truth: 20_MACHINES, 24_UPGRADES, 25_MISSIONS, 27_ACHIEVEMENTS,
--                  31_SERVER_AUTHORITY, 71_ARCHITECTURAL_LAWS.md law 26
--
-- This migration closes the three gaps left by 019:
--   * machine DEPLOY, so a player can actually start playing
--   * the UPGRADE action, so the upgrade tables are reachable
--   * MISSION CLAIM, which is the doc 25 idempotent claim
--
-- LAW 26: nothing here moves money. A mission claim pays a GAME RESOURCE, never
-- a financial amount. Verified by `check:migrations`-independent pgTAP tests in
-- supabase/tests/game.sql that inspect pg_proc.prosrc.
-- =============================================================================

-- Doc 20 MACHINE MODEL: deploy places a machine the player does not yet own.
-- Idempotent on (owner, type): deploying twice cannot create a duplicate rig.
create or replace function app_private.deploy_machine(
  p_user_id uuid,
  p_machine_type_code text,
  p_location_slot integer default null,
  p_action_id text default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns app.game_machines
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_player app.game_players;
  v_type app.game_machine_types;
  v_machine app.game_machines;
  v_version bigint;
begin
  -- Doc 31: idempotency first.
  if p_action_id is not null and
     exists (select 1 from app.game_events where action_id = p_action_id) then
    select * into v_machine
    from app.game_machines
    where owner_user_id = p_user_id
      and machine_type_id = (select id from app.game_machine_types where code = p_machine_type_code);
    return v_machine;
  end if;

  insert into app.game_players (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_player from app.game_players where user_id = p_user_id for update;

  select * into v_type
  from app.game_machine_types
  where code = p_machine_type_code and is_active
  for share;

  if not found then
    raise exception 'deploy_machine: % is not an available machine type', p_machine_type_code
      using errcode = 'check_violation';
  end if;

  -- Doc 20 unlock gating. A locked type is refused by the server, not hidden
  -- by the client.
  if v_player.level < v_type.unlock_level then
    raise exception 'deploy_machine: % unlocks at level %, you are level %',
      p_machine_type_code, v_type.unlock_level, v_player.level
      using errcode = 'check_violation';
  end if;

  -- One rig per type per player. A retried deploy returns the existing machine.
  select * into v_machine from app.game_machines
  where owner_user_id = p_user_id and machine_type_id = v_type.id;

  if found then
    return v_machine;
  end if;

  v_version := v_player.state_version;

  insert into app.game_machines (owner_user_id, machine_type_id, location_slot)
  values (p_user_id, v_type.id, p_location_slot)
  returning * into v_machine;

  update app.game_players set state_version = state_version + 1 where user_id = p_user_id;

  insert into app.game_events (
    user_id, machine_id, event_type, action_id, from_version, to_version, payload, client_ip
  ) values (
    p_user_id, v_machine.id, 'DEPLOY', p_action_id, v_version, v_version + 1,
    jsonb_build_object('typeCode', p_machine_type_code, 'correlationId', p_correlation_id),
    p_client_ip
  );

  return v_machine;
end;
$$;

-- Doc 24 UPGRADE APPLICATION: "Upgrade requests are checked and committed
-- server-side in a single authoritative state transition."
create or replace function app_private.request_machine_upgrade(
  p_user_id uuid,
  p_machine_id uuid,
  p_upgrade_code text,
  p_action_id text default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns app.game_upgrade_requests
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_machine app.game_machines;
  v_type app.game_machine_types;
  v_upgrade app.game_upgrades;
  v_request app.game_upgrade_requests;
  v_player app.game_players;
begin
  if p_action_id is not null and
     exists (select 1 from app.game_events where action_id = p_action_id) then
    select * into v_request from app.game_upgrade_requests where id::text = p_action_id;
    return v_request;
  end if;

  select * into v_player from app.game_players where user_id = p_user_id for update;

  select * into v_machine
  from app.game_machines
  where id = p_machine_id and owner_user_id = p_user_id
  for update;

  if not found then
    raise exception 'request_machine_upgrade: unknown machine for this user'
      using errcode = 'foreign_key_violation';
  end if;

  -- A machine mid-upgrade cannot start another. One transition at a time.
  if v_machine.state = 'UPGRADING' then
    raise exception 'request_machine_upgrade: machine is already upgrading'
      using errcode = 'check_violation';
  end if;

  select * into v_upgrade from app.game_upgrades where code = p_upgrade_code and is_active;
  if not found then
    raise exception 'request_machine_upgrade: % is not an available upgrade', p_upgrade_code
      using errcode = 'check_violation';
  end if;

  -- The upgrade must apply to the machine's CURRENT level. Server-side check.
  if v_upgrade.from_level <> v_machine.level then
    raise exception 'request_machine_upgrade: % applies at level %, machine is level %',
      p_upgrade_code, v_upgrade.from_level, v_machine.level
      using errcode = 'check_violation';
  end if;

  select * into v_type from app.game_machine_types where id = v_machine.machine_type_id;

  if v_upgrade.to_level > v_type.max_level then
    raise exception 'request_machine_upgrade: % exceeds the maximum level for this machine',
      p_upgrade_code using errcode = 'check_violation';
  end if;

  -- Doc 24 prerequisites. A chained upgrade cannot be skipped.
  if v_upgrade.prerequisite_code is not null and not exists (
    select 1 from app.game_events
    where user_id = p_user_id and event_type = 'UPGRADE_COMPLETED'
      and payload->>'code' = v_upgrade.prerequisite_code
  ) then
    raise exception 'request_machine_upgrade: prerequisite % not met', v_upgrade.prerequisite_code
      using errcode = 'check_violation';
  end if;

  if v_player.energy_current < v_upgrade.energy_cost then
    raise exception 'request_machine_upgrade: insufficient energy (% of % required)',
      v_player.energy_current, v_upgrade.energy_cost using errcode = 'check_violation';
  end if;

  update app.game_players
  set energy_current = energy_current - v_upgrade.energy_cost,
      state_version = state_version + 1
  where user_id = p_user_id;

  update app.game_machines
  set state = 'UPGRADING', state_version = state_version + 1
  where id = p_machine_id;

  insert into app.game_upgrade_requests (user_id, upgrade_id, machine_id, completes_at)
  values (
    p_user_id, v_upgrade.id, p_machine_id,
    now() + make_interval(secs => v_upgrade.duration_seconds)
  )
  returning * into v_request;

  insert into app.game_events (
    user_id, machine_id, event_type, action_id, from_version, to_version, payload, client_ip
  ) values (
    p_user_id, p_machine_id, 'UPGRADE_REQUESTED', p_action_id,
    v_player.state_version, v_player.state_version + 1,
    jsonb_build_object('code', p_upgrade_code, 'correlationId', p_correlation_id),
    p_client_ip
  );

  return v_request;
end;
$$;

-- Doc 25 CLAIMING: "Claim is an idempotent authoritative action. A mission
-- cannot pay twice."
--
-- LAW 26: this pays a GAME RESOURCE into the game inventory. It does not pay
-- money. A mission may carry a `reward_source_id` for a funded financial
-- promotion, but this function never reads it to move money: a financial reward
-- must go through the Reward Engine, which is deliberately not reachable from
-- here.
create or replace function app_private.claim_mission(
  p_user_id uuid,
  p_mission_code text,
  p_action_id text default null,
  p_correlation_id uuid default null
) returns app.game_mission_progress
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_mission app.game_missions;
  v_progress app.game_mission_progress;
  v_target bigint;
  v_objective jsonb;
begin
  -- Doc 31: idempotency first. A retried claim returns the existing record and
  -- pays nothing a second time.
  if p_action_id is not null and
     exists (select 1 from app.game_events where action_id = p_action_id) then
    select * into v_progress
    from app.game_mission_progress
    where user_id = p_user_id
      and mission_id = (select id from app.game_missions where code = p_mission_code);
    return v_progress;
  end if;

  select * into v_mission from app.game_missions where code = p_mission_code and is_active;
  if not found then
    raise exception 'claim_mission: % is not an available mission', p_mission_code
      using errcode = 'check_violation';
  end if;

  -- Doc 26 SCHEDULING applied to missions: server time decides the window. A
  -- client clock cannot extend a mission.
  if v_mission.available_from is not null and v_mission.available_from > now() then
    raise exception 'claim_mission: mission has not opened' using errcode = 'check_violation';
  end if;

  if v_mission.available_until is not null and v_mission.available_until < now() then
    raise exception 'claim_mission: mission has closed' using errcode = 'check_violation';
  end if;

  select * into v_progress
  from app.game_mission_progress
  where user_id = p_user_id and mission_id = v_mission.id
  for update;

  if not found then
    raise exception 'claim_mission: no progress on this mission' using errcode = 'check_violation';
  end if;

  -- The idempotency that actually matters: an already-claimed mission pays
  -- nothing. This is the "a mission cannot pay twice" rule.
  if v_progress.claim_status = 'CLAIMED' then
    return v_progress;
  end if;

  if v_progress.status <> 'COMPLETED' then
    raise exception 'claim_mission: mission is not complete' using errcode = 'check_violation';
  end if;

  -- Doc 25 MISSION MODEL: completion is decided by the declared objectives.
  v_target := 0;
  for v_objective in select * from jsonb_array_elements(v_mission.objectives)
  loop
    v_target := greatest(v_target, (v_objective->>'target')::bigint);
  end loop;

  if v_target <= 0 then
    raise exception 'claim_mission: mission has no objectives' using errcode = 'check_violation';
  end if;

  if v_progress.progress < v_target then
    raise exception 'claim_mission: progress is % of %', v_progress.progress, v_target
      using errcode = 'check_violation';
  end if;

  -- The game-native payout. A resource quantity, into the game inventory.
  if v_mission.reward_quantity > 0 then
    insert into app.game_inventory (user_id, resource_id, quantity)
    values (p_user_id, v_mission.reward_resource_id, v_mission.reward_quantity)
    on conflict (user_id, resource_id) do update
      set quantity = app.game_inventory.quantity + excluded.quantity,
          updated_at = now();
  end if;

  update app.game_mission_progress
  set claim_status = 'CLAIMED', claimed_at = now()
  where user_id = p_user_id and mission_id = v_mission.id
  returning * into v_progress;

  insert into app.game_events (
    user_id, event_type, action_id, payload
  ) values (
    p_user_id, 'MISSION_CLAIMED', p_action_id,
    jsonb_build_object(
      'code', p_mission_code,
      'quantity', v_mission.reward_quantity,
      'resourceId', v_mission.reward_resource_id,
      'correlationId', p_correlation_id
    )
  );

  return v_progress;
end;
$$;

revoke all on function app_private.deploy_machine(uuid, text, integer, text, inet, uuid) from public, anon, authenticated;
revoke all on function app_private.request_machine_upgrade(uuid, uuid, text, text, inet, uuid) from public, anon, authenticated;
revoke all on function app_private.claim_mission(uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function app_private.deploy_machine(uuid, text, integer, text, inet, uuid) to service_role;
grant execute on function app_private.request_machine_upgrade(uuid, uuid, text, text, inet, uuid) to service_role;
grant execute on function app_private.claim_mission(uuid, text, text, uuid) to service_role;