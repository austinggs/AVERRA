import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields, isMissingSchemaError } from '@/lib/observability/errors';

// GET  /api/game         authoritative state snapshot
// POST /api/game         one validated game action
//
// Doc 31 splits client and server responsibility: the client renders and
// predicts, the server validates and commits. This route is the boundary. It
// reads authoritative state and forwards a single action; it never computes
// production, energy, or output itself.
//
// LAW 26: nothing here touches money. Game resources are virtual.

export const GET = route(async ({ user }) => {
  const admin = createAdminClient();

  // Routed through `public.get_game_state`, NOT `.from('game_*')`.
  //
  // The `app` schema is deliberately not exposed through the Data API, so a
  // PostgREST read of a game table fails with PGRST205 even when every migration
  // is applied. The wrapper returns the same camelCase shape the client expects,
  // so this replaces five separate queries with one call.
  const { data, error } = await admin.rpc('get_game_state', { p_user_id: user!.id });

  if (error) {
    console.error(
      '[api] game state read failed',
      isMissingSchemaError(error)
        ? errorFields(error, {
            cause:
              'the read failed. If public.get_game_state does not exist, migration 030 ' +
              'has not been applied.',
          })
        : errorFields(error),
    );
    throw new RouteError('internal_error', 'Could not read game state.');
  }

  // `data` is already the authoritative snapshot: enrolled, player, machines,
  // inventory, missions and achievements. Nothing is recomputed here.
  return NextResponse.json(data ?? { enrolled: false, machines: [], inventory: [] });
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('START'),
    machineId: z.string().uuid(),
    actionId: z.string().trim().min(8).max(120),
    expectedVersion: z.coerce.bigint().positive().optional(),
  }),
  z.object({
    action: z.literal('STOP'),
    machineId: z.string().uuid(),
    actionId: z.string().trim().min(8).max(120),
    expectedVersion: z.coerce.bigint().positive().optional(),
  }),
  z.object({
    action: z.literal('COLLECT'),
    machineId: z.string().uuid(),
    actionId: z.string().trim().min(8).max(120),
    expectedVersion: z.coerce.bigint().positive().optional(),
  }),
  // Doc 20: deployment places a machine the player does not own.
  z.object({
    action: z.literal('DEPLOY'),
    machineTypeCode: z.string().trim().min(2).max(40),
    actionId: z.string().trim().min(8).max(120),
  }),
  // Doc 24: an upgrade request.
  z.object({
    action: z.literal('UPGRADE'),
    machineId: z.string().uuid(),
    upgradeCode: z.string().trim().min(2).max(40),
    actionId: z.string().trim().min(8).max(120),
  }),
  // Doc 25 CLAIMING: an idempotent claim.
  z.object({
    action: z.literal('CLAIM_MISSION'),
    missionCode: z.string().trim().min(2).max(40),
    actionId: z.string().trim().min(8).max(120),
  }),
]);

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'That action was not valid.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const input = parsed.data;
  const admin = createAdminClient();

  // Deploy, upgrade and claim each have their own authoritative function. They
  // are deliberately NOT folded into perform_game_action, because they have
  // different prerequisites and different failure modes, and one function per
  // concern keeps each invariant local.
  if (input.action === 'DEPLOY') {
    const { error } = await admin.rpc('deploy_machine', {
      p_user_id: user!.id,
      p_machine_type_code: input.machineTypeCode,
      p_location_slot: null,
      p_action_id: input.actionId,
      p_client_ip: null,
      p_correlation_id: correlationId,
    });

    if (error) {
      if (error.message.includes('unlocks at level')) {
        throw new RouteError('forbidden', error.message);
      }
      if (error.message.includes('not an available machine type')) {
        throw new RouteError('conflict', 'That machine is not available yet.');
      }
      console.error('[api] deploy failed', errorFields(error, { correlationId }));
      throw new RouteError('internal_error', 'Could not deploy that machine.');
    }
    return NextResponse.json({ action: 'DEPLOY', ok: true });
  }

  if (input.action === 'UPGRADE') {
    const { error } = await admin.rpc('request_machine_upgrade', {
      p_user_id: user!.id,
      p_machine_id: input.machineId,
      p_upgrade_code: input.upgradeCode,
      p_action_id: input.actionId,
      p_client_ip: null,
      p_correlation_id: correlationId,
    });

    if (error) {
      const message = error.message;
      if (message.includes('already upgrading')) {
        throw new RouteError('conflict', 'That machine is already upgrading.');
      }
      if (message.includes('insufficient energy')) {
        throw new RouteError('insufficient_energy', 'Not enough energy for that upgrade.');
      }
      if (message.includes('prerequisite')) {
        throw new RouteError('conflict', 'Complete the previous upgrade first.');
      }
      if (message.includes('applies at level')) {
        throw new RouteError('conflict', 'That upgrade does not apply to this machine yet.');
      }
      console.error('[api] upgrade failed', { correlationId, error: message });
      throw new RouteError('internal_error', 'Could not start that upgrade.');
    }
    return NextResponse.json({ action: 'UPGRADE', ok: true });
  }

  if (input.action === 'CLAIM_MISSION') {
    const { error } = await admin.rpc('claim_mission', {
      p_user_id: user!.id,
      p_mission_code: input.missionCode,
      p_action_id: input.actionId,
      p_correlation_id: correlationId,
    });

    if (error) {
      const message = error.message;
      if (message.includes('not complete') || message.includes('progress is')) {
        throw new RouteError('conflict', 'That mission is not complete yet.');
      }
      if (message.includes('has closed')) {
        throw new RouteError('conflict', 'That mission has ended.');
      }
      console.error('[api] claim failed', { correlationId, error: message });
      throw new RouteError('internal_error', 'Could not claim that mission.');
    }
    return NextResponse.json({
      action: 'CLAIM_MISSION',
      ok: true,
      message: 'Mission reward added to your inventory. This is a game resource, not money.',
    });
  }

  const action = input.action;
  const machineId = input.machineId;
  const actionId = input.actionId;
  const expectedVersion = input.expectedVersion;

  const { data, error } = await admin.rpc('perform_game_action', {
    p_user_id: user!.id,
    p_action: action,
    p_machine_id: machineId,
    p_action_id: actionId,
    p_expected_version: expectedVersion?.toString() ?? null,
    p_client_ip: null,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = error.message;

    // The client predicted against a state that has since moved. This is a
    // normal race, not a failure: the client should resync, not retry blindly.
    if (message.includes('client presented')) {
      throw new RouteError('conflict', 'The game state moved on. Resync and try again.');
    }

    if (message.includes('insufficient energy')) {
      throw new RouteError('insufficient_energy', 'Not enough energy for that action.');
    }

    if (message.includes('nothing produced yet')) {
      throw new RouteError('conflict', 'That machine has not produced anything yet.');
    }

    if (message.includes('cannot start') || message.includes('cannot stop')) {
      throw new RouteError('conflict', 'That machine is not in a state to do that.');
    }

    if (message.includes('unknown machine')) {
      throw new RouteError('not_found', 'Unknown machine.');
    }

    console.error('[api] game action failed', errorFields(error, { correlationId }));
    throw new RouteError('internal_error', 'That action could not be completed.');
  }

  const result = (data ?? {}) as Record<string, unknown>;

  // Doc 31 returns the authoritative state and version. The client reconciles
  // its prediction against this rather than assuming its guess was right.
  return NextResponse.json({
    action,
    replayed: result.replayed === true,
    machineState: result.machineState ?? null,
    energy: result.energy ?? null,
    stateVersion: result.stateVersion ?? null,
  });
});
