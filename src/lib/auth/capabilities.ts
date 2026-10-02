import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SessionUser } from '@/lib/auth/session';

// Capability-based authorization (ADR-0002).
//
// Capabilities are the authorization primitive; roles are bundles of them. The
// same capability codes are used by SQL guards, RLS, these server guards and the
// admin UI, so they cannot drift apart.
//
// WHY THIS QUERIES EXPLICITLY RATHER THAN CALLING app.has_capability():
// app.has_capability() reads auth.uid(). Route handlers run with the service
// role, where auth.uid() is null, so calling it would return false for everyone
// and quietly deny every admin action. Passing the already-verified user id is
// both correct and safer: the identity came from a verified JWT claim, never
// from the request body.

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(
    readonly capability: string,
    message = 'You do not have permission to perform this action.',
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;

  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Returns the user's active administrative role, or null. A revoked assignment
 * is not a role.
 */
export async function getActiveAdminRole(userId: string): Promise<string | null> {
  const admin = createAdminClient();

  // Routed through `public.get_active_admin_role`, NOT `.from('admin_users')`.
  // The `app` schema is not exposed through the Data API.
  //
  // Fail closed: an authorization lookup that errors must never become a pass,
  // so an RPC failure returns null, which every caller treats as "not an admin".
  const { data, error } = await admin.rpc('get_active_admin_role', { p_user_id: userId });

  if (error) {
    // Fail closed. An authorization lookup that errors must never become a pass.
    return null;
  }

  return typeof data === 'string' && data.length > 0 ? data : null;
}

/** Every capability granted to the user's active role. Empty for non-admins. */
export async function getCapabilities(userId: string): Promise<string[]> {
  const roleCode = await getActiveAdminRole(userId);
  if (!roleCode) return [];

  const admin = createAdminClient();

  // Routed through `public.get_role_capabilities`, NOT
  // `.from('admin_role_capabilities')`. The `app` schema is not exposed through
  // the Data API.
  const { data, error } = await admin.rpc('get_role_capabilities', { p_role_code: roleCode });

  if (error) return [];

  return ((data ?? []) as Array<{ code: string }>).map((row) => row.code);
}

/**
 * Authorizes a privileged action. Throws rather than returning a boolean, so a
 * caller cannot forget to check the result.
 *
 * Dual control note: a capability grants permission to PERFORM an action. For
 * high-value operations the approver-separation rule is enforced separately by
 * app_private.assert_distinct_approver, because a capability cannot express
 * "and not by the person who prepared it".
 */
export async function requireCapability(
  user: SessionUser | null,
  capability: string,
): Promise<string> {
  if (!user) {
    throw new UnauthenticatedError();
  }

  const capabilities = await getCapabilities(user.id);

  if (!capabilities.includes(capability)) {
    throw new AuthorizationError(capability);
  }

  return user.id;
}

export async function hasCapability(
  user: SessionUser | null,
  capability: string,
): Promise<boolean> {
  if (!user) return false;

  try {
    await requireCapability(user, capability);
    return true;
  } catch {
    return false;
  }
}
