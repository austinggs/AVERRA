import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';

// PRIVILEGED client. Bypasses Row Level Security entirely.
// The SUPABASE_SECRET_KEY must never reach the browser bundle. This module is
// guarded by the server-only package, so importing it from client code is a
// build-time error rather than a runtime leak.
export function createAdminClient() {
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
