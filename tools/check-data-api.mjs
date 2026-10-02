// =============================================================================
// check-data-api.mjs
//
// The `app` schema is NOT exposed through the Supabase Data API. A
// `createAdminClient().from('some_app_table')` therefore queries
// `public.some_app_table`, which does not exist, and fails with PGRST205.
//
// That failure is silent-ish: it looks like a missing-migrations problem, it
// only appears at runtime, and it happens on whichever page happens to be the
// first one exercised. Three separate defects of exactly this shape shipped in
// this repository before this gate existed:
//
//   * unread notification counts,
//   * every task list, detail and attempt read,
//   * provider callback evidence, which meant NO provider callback was ever
//     recorded, because the write failed silently on the append-only evidence log
//     the whole fraud posture depends on.
//
// The fix in every case was a bounded, service-role-only `public` RPC wrapper.
// This gate exists so the same mistake cannot be reintroduced by a line that
// "looks fine".
//
// WHAT THIS DOES NOT DO: it is a name check, not a schema parser. It knows the
// table names in `app`; it cannot know that a wrapper returns a bounded shape,
// that it scopes by the session user, or that it is granted only to
// service_role. Those are properties of SQL and are asserted in pgTAP and by the
// grants themselves. Do not treat a green run here as evidence that a read is
// correctly scoped.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

// Every table created in the `app` schema, harvested from the migrations rather
// than hand-maintained. A hand-maintained list rots, and a rotted list silently
// stops catching the thing it exists to catch.
function harvestAppTables() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const tables = new Set();
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?app\.(\w+)/gi;

  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
  } catch {
    console.error('check-data-api: cannot read supabase/migrations');
    process.exit(1);
  }

  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    for (const match of sql.matchAll(pattern)) {
      tables.add(match[1]);
    }
  }

  if (tables.size === 0) {
    // A harvest that finds nothing means the migrations directory moved or the
    // pattern broke. Fail loudly rather than passing vacuously.
    console.error('check-data-api: found 0 app tables, refusing to pass vacuously');
    process.exit(1);
  }

  return tables;
}

const APP_TABLES = harvestAppTables();

// `.from('x')` / `.from("x")`. Chained calls and template literals are NOT
// matched: a dynamic table name is already unreviewable by a regex, and the
// call sites that matter are all literal.
const FROM_CALL = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * True when the line is a comment rather than a call.
 *
 * The converted call sites deliberately NAME the table they no longer read, in
 * a comment explaining why. Flagging those would train an agent or a developer
 * to delete the explanation, which is the one part of the change worth keeping.
 */
function isComment(line) {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  );
}

const violations = [];
const files = walk(SRC);

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isComment(line)) return;

    for (const match of line.matchAll(FROM_CALL)) {
      const table = match[1];

      if (!APP_TABLES.has(table)) continue;

      violations.push({
        file: relative(ROOT, file),
        line: index + 1,
        table,
        source: line.trim(),
      });
    }
  });
}

console.log(`check-data-api: ${APP_TABLES.size} app tables, ${files.length} source files scanned`);

if (violations.length > 0) {
  console.error('');
  console.error(`check-data-api: ${violations.length} direct Data API access to app tables\n`);

  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  app.${v.table}`);
    console.error(`    ${v.source}`);
  }

  console.error('');
  console.error('The `app` schema is not exposed through the Supabase Data API.');
  console.error('A .from() call on one of these tables fails with PGRST205 at runtime,');
  console.error('even with every migration applied.');
  console.error('');
  console.error('Use a bounded, service-role-only `public` RPC wrapper instead, and scope');
  console.error('it by the authenticated session user id, never a request-body id.');
  console.error('If no wrapper exists, add one. Do NOT add `app` to the Data API.');
  console.error('');
  process.exit(1);
}

console.log('check-data-api: OK - no direct Data API access to app tables');
