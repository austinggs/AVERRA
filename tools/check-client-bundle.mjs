#!/usr/bin/env node
// Fails if any CLIENT-SERVED asset contains secret-shaped material.
// Guards architectural law 71 (secret boundary) and doc 61 (deployment).
//
// Rationale: NEXT_PUBLIC_* is inlined into the browser bundle by design, while
// server-only secrets must never be. This check turns "we were careful" into a
// build-time gate.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.next/static';

const FORBIDDEN = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'service_role JWT claim', re: /c2VydmljZV9yb2xl/ },
  {
    name: 'postgres connection string with credentials',
    re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/,
  },
  { name: 'server-only env var name', re: /SUPABASE_SECRET_KEY|SUPABASE_DB_URL/ },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (files.length === 0) {
  console.error('check-client-bundle: no files under ' + ROOT + '. Run a build first.');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) {
      console.error('SECRET LEAK: ' + rule.name + ' found in client asset ' + file);
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error('check-client-bundle: FAILED with ' + failures + ' finding(s).');
  process.exit(1);
}
console.log(
  'check-client-bundle: OK - scanned ' + files.length + ' client asset(s), no secrets found.',
);
