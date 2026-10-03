#!/usr/bin/env node
// Run the pgTAP suites against Supabase through the CONNECTION POOLER.
//
// WHY THIS EXISTS (docs/DISCREPANCIES.md Q-16)
//
// `tools/run-db-tests.mjs` reads SUPABASE_DB_URL from the process environment and
// skips cleanly when it is absent. That is deliberate, and it is also why the
// suites sat unexecuted for the life of the project: `.env.local` carries the
// PASSWORD but points at the DIRECT host, and `supabase/.temp/pooler-url` carries
// the POOLER host but no password. Neither file alone is a usable connection
// string, so the two halves are joined here.
//
//   .env.local        -> password, direct host (IPv6-only since Jan 2024)
//   .temp/pooler-url  -> user, pooler host, port, database, no password
//
// The direct host resolves to AAAA-only on a project without IPv6, so a direct
// connection dies with getaddrinfo ENOTFOUND before a single assertion runs. The
// pooler works over plain IPv4.
//
// SECRET HANDLING, WHICH IS THE WHOLE POINT OF A SEPARATE FILE
//
// The composed URL is never printed, never logged, and never written to disk. It
// exists only in this process's memory and in the environment of the child we
// spawn. The password is percent-encoded because a password containing reserved
// characters such as [ or ] is not a legal URI userinfo component and would
// otherwise fail to parse.
//
// Usage:
//   node tools/run-db-tests-pooled.mjs            # all suites
//   node tools/run-db-tests-pooled.mjs reviews    # one suite by substring
//
// Requires the direct (non-pooler) password in `.env.local`, which is gitignored.

import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads a KEY=VALUE from `.env.local`, ignoring comments and blank lines. */
function readEnvFileValue(key) {
  if (!existsSync(join(ROOT, '.env.local'))) return null;

  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const eq = trimmed.indexOf('=');
    if (trimmed.slice(0, eq).trim() !== key) continue;

    // Strip surrounding quotes; a password may legitimately contain # or =.
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }

  return null;
}

/** The password only. Never logged, never returned anywhere but the child env. */
function readPasswordFromEnvLocal() {
  const raw = readEnvFileValue('SUPABASE_DB_URL');
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    return parsed.password ? decodeURIComponent(parsed.password) : null;
  } catch {
    return null;
  }
}

/**
 * User, host, port and database from the CLI's own pooler record.
 *
 * The port matters: the CLI records 5432 (SESSION mode), not 6543 (transaction
 * mode). Session mode is correct here because each suite runs `begin; ... rollback;`
 * and pgTAP relies on session-level state. Transaction mode would silently break
 * prepared statements and `SET`.
 */
function readPoolerTarget() {
  const path = join(ROOT, 'supabase', '.temp', 'pooler-url');
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!parsed.hostname) return null;

    return {
      user: parsed.username || null,
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
    };
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`run-db-tests-pooled: ${message}`);
  process.exit(1);
}

const password = readPasswordFromEnvLocal();
if (!password) {
  fail(
    'no password found. `.env.local` needs SUPABASE_DB_URL with the database password ' +
      'in it (the host may stay the direct one; only the password is used).',
  );
}

const target = readPoolerTarget();
if (!target) {
  fail('supabase/.temp/pooler-url is absent. Run `npx supabase link` first.');
}

if (target.port !== '5432') {
  console.warn(
    `run-db-tests-pooled: pooler port is ${target.port}. Session mode (5432) is ` +
      'expected for pgTAP; transaction mode can break prepared statements.',
  );
}

// encodeURIComponent is REQUIRED, not cosmetic: a password containing [ or ] is
// not legal in a URI userinfo component and fails to parse unencoded.
const connectionString =
  `postgresql://${encodeURIComponent(target.user ?? 'postgres')}` +
  `:${encodeURIComponent(password)}` +
  `@${target.host}:${target.port}/${encodeURIComponent(target.database)}`;

/**
 * Waits for the pooler hostname to resolve before spawning the runner.
 *
 * Observed in practice: repeated `getaddrinfo EAI_AGAIN` failures partway through a
 * run, which aborted every remaining suite and produced a wall of FAILs that had
 * nothing to do with the code under test. EAI_AGAIN is a resolver timeout, not a
 * refused connection, and it is transient.
 *
 * This deliberately does NOT retry the tests. A resolver check that fails fast and
 * loudly is cheap; re-running a suite to make it pass is how a real failure gets
 * rounded off. If the name resolves, we spawn exactly once.
 */
async function waitForDns(host, attempts = 6, delayMs = 4000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await lookup(host);
      return true;
    } catch {
      if (attempt === attempts) return false;

      process.stderr.write(
        `run-db-tests-pooled: DNS lookup for ${host} failed (attempt ${attempt}/${attempts}), retrying...\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

if (!(await waitForDns(target.host))) {
  fail(
    `could not resolve ${target.host} after ${6} attempts. This is a DNS/connectivity ` +
      'problem, not a test failure - nothing was executed.',
  );
}

const args = ['tools/run-db-tests.mjs', ...process.argv.slice(2)];

const child = spawn(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Inherited by the child ONLY. Never written, never printed.
    SUPABASE_DB_URL: connectionString,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`run-db-tests-pooled: child terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  fail(`could not start the pgTAP runner: ${error.message}`);
});
