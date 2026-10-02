import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

// Browser client. Uses ONLY the publishable key, which is safe to expose and is
// constrained by Row Level Security.
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
