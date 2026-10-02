import 'server-only';
import { z } from 'zod';

// Server-only environment. These values MUST NEVER be prefixed with
// NEXT_PUBLIC_ or imported from client components.
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1),
  CELO_CHAIN_ID: z.coerce.number().int().positive().default(42220),
  CELO_RPC_URL: optionalUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Lazy for the same reason as env.ts: importing this module must not throw
// during build-time page collection. The secret is read on first use.
function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    CELO_CHAIN_ID: process.env.CELO_CHAIN_ID,
    CELO_RPC_URL: process.env.CELO_RPC_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid server environment: ${issues}`);
  }

  return parsed.data;
}

let cached: ServerEnv | null = null;

/** Lazily validated server environment. */
export function getServerEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}

/**
 * @deprecated Use {@link getServerEnv}. Retained as a lazily-read object so
 * `serverEnv.X` call sites keep working without evaluating at import time.
 */
export const serverEnv: ServerEnv = {
  get SUPABASE_SECRET_KEY(): string {
    return getServerEnv().SUPABASE_SECRET_KEY;
  },
  get SUPABASE_DB_URL(): string {
    return getServerEnv().SUPABASE_DB_URL;
  },
  get CELO_CHAIN_ID(): number {
    return getServerEnv().CELO_CHAIN_ID;
  },
  get CELO_RPC_URL(): string | undefined {
    return getServerEnv().CELO_RPC_URL;
  },
} as ServerEnv;
