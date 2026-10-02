#!/usr/bin/env node
// Grant-ordering gate for functions in the exposed `public` schema.
//
// WHY THIS EXISTS
//
// PostgreSQL grants EXECUTE on every new function to the PUBLIC pseudo-role, and
// Supabase's default ACL for schema `public` additionally grants EXECUTE to
// `anon` and `authenticated`. A function in `public` is therefore BORN
// executable by an unauthenticated end user unless it is explicitly revoked.
//
// This was a live breach, not a theoretical one. 29 wrappers from migrations
// 030/031/032/034 were callable by anyone holding the publishable key:
//
//   POST /rest/v1/rpc/get_wallet_summary -> 200 {"userFunding": [], ...}
//
// Every one of them scopes its query by a p_user_id, which prevents CROSS-USER
// access but does nothing about UNAUTHENTICATED access. Fixing it took
// migration 036. See Q-22 in docs/DISCREPANCIES.md.
//
// WHY A STATIC CHECK IS NOT SUFFICIENT
//
// The database is the only thing that can answer "is this actually revoked?".
// `has_function_privilege` is authoritative; this file is not. So this gate
// checks the SOURCE for the pattern that produces a safe function, and the
// pgTAP suite plus a live query are what prove the applied state. Two layers,
// because source can look right while the database disagrees.
//
// THE ORDER IS THE POINT
//
// `revoke` must come BEFORE `grant`. A grant to service_role does not remove an
// inherited PUBLIC or anon grant; only the revoke does. A file that grants
// service_role and never revokes is exactly the defect this gate exists to find.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const errors = [];
let checked = 0;

for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const source = readFileSync(join(migrationsDir, file), 'utf8');

  // Strip comment lines: prose describing a revoke is not a revoke.
  const code = source
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');

  const decls = [...source.matchAll(/^create (?:or replace )?function\s+([\w.]+)\s*\(/gim)];

  decls.forEach((decl) => {
    const qualified = decl[1].toLowerCase();
    const [schema] = qualified.split('.');

    // Only the exposed schema matters. app and app_private are not reachable
    // through the Data API, so an anon grant there is inert.
    if (schema !== 'public') return;

    const startLine = source.slice(0, decl.index).split(/\r?\n/).length;
    checked += 1;

    // A REVOKE MAY LIVE ANYWHERE IN THE FILE, NOT ONLY IN THE FUNCTION'S BLOCK.
    //
    // This gate originally scoped the search to the text between one declaration
    // and the next, and reported 63 errors on migrations 030 and 031. All 63
    // were false positives: those files declare every function first and then
    // list all revokes and grants together in a trailing block, which is a
    // perfectly good layout that the scoped search could not see.
    //
    // That matters because this same source is the evidence for the live leak in
    // Q-22. A check that condemns correct migrations is worse than no check: it
    // gets "fixed" by deleting correct revokes. The trade is deliberate - the
    // whole file is searched, so this cannot false-positive on layout, at the
    // cost of not detecting a revoke aimed at the WRONG function. That gap is
    // covered by the live has_function_privilege assertion instead.
    const esc = qualified.replace(/\./g, '\\.');
    const own = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${esc}\\s*\\([^)]*\\)[^;]*?\\bfrom\\b([^;]*);`,
      'i',
    ).exec(code);

    const roles = own ? own[1].toLowerCase() : '';
    const revokesFromPublic = /\bpublic\b/.test(roles);
    const revokesFromAnon = /\banon\b/.test(roles);
    const revokesFromAuthenticated = /\bauthenticated\b/.test(roles);

    if (!revokesFromPublic) {
      errors.push(
        `${file}:${startLine}: ${qualified} never revokes from the PUBLIC pseudo-role. ` +
          'PostgreSQL grants EXECUTE to PUBLIC on every new function by default, so it is ' +
          `callable by anyone who can reach the Data API. Add: revoke all on function ` +
          `${qualified}(...) from public, anon, authenticated;`,
      );
    }
    if (!revokesFromAnon) {
      errors.push(
        `${file}:${startLine}: ${qualified} never revokes from anon. The Supabase default ` +
          'ACL for schema public grants EXECUTE to anon, so an unauthenticated caller ' +
          'holding the publishable key can call it.',
      );
    }
    if (!revokesFromAuthenticated) {
      errors.push(
        `${file}:${startLine}: ${qualified} never revokes from authenticated. A signed-in end ` +
          'user could call it directly, bypassing the server.',
      );
    }

    // Revoke must precede grant, or an inherited PUBLIC grant survives a
    // function that reads as correctly locked down.
    const revokeIdx = code.search(/\brevoke\b/i);
    const grantIdx = code.search(/\bgrant\s+execute\b/i);
    if (revokeIdx !== -1 && grantIdx !== -1 && grantIdx < revokeIdx) {
      errors.push(
        `${file}:${startLine}: ${qualified} grants execute to service_role BEFORE it revokes. ` +
          'A grant does not remove an inherited PUBLIC or anon grant, so the function ' +
          'stays reachable. Revoke first, then grant.',
      );
    }
  });
}

for (const error of errors) console.log(`    - ${error}`);

console.log(
  `\ncheck-grants: ${errors.length === 0 ? 'OK' : 'FAILED'} - ${checked} public function(s) checked, ${errors.length} error(s).`,
);

process.exit(errors.length === 0 ? 0 : 1);
