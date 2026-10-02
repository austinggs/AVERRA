#!/usr/bin/env node
// Live pgTAP runner for supabase/tests/.
//
// WHY THIS EXISTS
//
// `supabase test db` (aliased as `npm run test:db:cli`) shells out to pg_prove,
// which needs Docker or a linked project. This runner needs neither: it connects
// straight to SUPABASE_DB_URL and reproduces what pgTAP emits.
//
// The suites had never been executed - Docker was unavailable on the development
// machine - and every one of the ten had at least one defect. A runner is only
// useful if its green run is trustworthy, so this tool is built around the two
// failures this repository has already been burned by:
//
//  1. A CHECK MUST COUNT ITS WHOLE POPULATION.
//     A previous "leak check" filtered the population before counting it, so its
//     predicate matched nothing and reported `0 bad` as a security assurance. The
//     same trap here is quieter: a suite that never ran emits no `not ok` line.
//     So this runner reports the total alongside the bad count, and treats a
//     suite that produced no assertions as a FAILURE, never as a pass.
//
//  2. ONE CONNECTION PER SUITE.
//     Every suite is `begin; ... rollback;`. An error inside it aborts the
//     transaction, and every later statement on that connection then fails with
//     "current transaction is aborted". Running ten suites down one connection
//     turns one real failure into ten, which hides which suite is actually
//     broken. Each suite therefore gets its own connection.
//
// It also asserts `ok + not ok == plan`. pgTAP only fails a suite whose plan is
// INCOMPLETE at `finish()`; a suite that aborted before `finish()` emits no
// finish line at all, and a naive reader would see a short but entirely green
// transcript. Pairing the counts against the declared plan closes that hole.
//
// USAGE
//   node tools/run-db-tests.mjs                # needs SUPABASE_DB_URL
//   node tools/run-db-tests.mjs --verbose      # print every assertion
//   node tools/run-db-tests.mjs --require-db   # a missing URL is fatal (CI)
//   node tools/run-db-tests.mjs --verify-split # prove the splitter changes nothing
//
// With no database reachable it prints SKIP and exits 0, so a developer without
// credentials is not blocked. `--require-db` turns that skip into a failure and
// is what CI uses, so a database job that silently did nothing cannot go green.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const testsDir = join(process.cwd(), 'supabase', 'tests');

const argv = new Set(process.argv.slice(2));
const verbose = argv.has('--verbose') || argv.has('-v');
const requireDb = argv.has('--require-db');
const verifySplit = argv.has('--verify-split');

// ---------------------------------------------------------------------------
// Statement splitting.
//
// A pgTAP suite is a batch of statements, and node-postgres's simple query
// protocol hands back an array of results for a batch - but only if the batch
// SUCCEEDS. When a statement raises, the driver rejects and every result already
// produced is lost, so a suite with one bad statement reports nothing but the
// error. Splitting keeps the assertions that did execute, which is the difference
// between "the enum vocabulary test failed" and "syntax error".
//
// The splitter therefore has to be exact. It tracks dollar-quoting ($tag$),
// single quotes, double quotes, line comments and block comments, so a `;` inside
// `$$ ... $$` or inside a literal is not a boundary. `$1` and a bare `$` are not
// dollar-quote openings (a tag may not begin with a digit), so they pass through.
// ---------------------------------------------------------------------------
function splitStatements(source) {
  const statements = [];
  let start = 0;
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // Line comment: -- to end of line.
    if (ch === '-' && next === '-') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Block comment. PostgreSQL nests these, so track depth.
    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // Single-quoted literal. A doubled quote escapes, it does not close.
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Double-quoted identifier.
    if (ch === '"') {
      i += 1;
      while (i < n) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Dollar quoting: $tag$ ... $tag$, tag empty or an identifier.
    if (ch === '$') {
      const tagMatch = source.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const open = tagMatch[0];
        const close = source.indexOf(open, i + open.length);
        if (close === -1) throw new Error('unterminated dollar quote ' + open);
        i = close + open.length;
        continue;
      }
      // A `$` that is not a dollar quote ($1, or a bare $) is just a character.
      i += 1;
      continue;
    }

    // A top-level semicolon ends a statement.
    if (ch === ';') {
      const text = source.slice(start, i + 1).trim();
      if (text) statements.push(text);
      i += 1;
      start = i;
      continue;
    }

    i += 1;
  }

  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

// ---------------------------------------------------------------------------
// TAP parsing.
//
// pgTAP functions are ordinary SQL functions that RETURN TEXT, so each
// `select ok(...)` yields one row whose single column is the TAP line. A suite
// can therefore only be understood by collecting every result set. pgTAP also
// emits `# ...` diagnostics (the `Have:` / `Want:` pairs that make a failure
// actionable), which belong to the `not ok` line that precedes them.
// ---------------------------------------------------------------------------
function collectTap(results) {
  const lines = [];
  for (const res of results) {
    if (!res || !res.rows) continue;
    for (const row of res.rows) {
      for (const value of Object.values(row)) {
        if (typeof value !== 'string') continue;
        for (const line of value.split('\n')) lines.push(line);
      }
    }
  }
  return lines;
}

function parseTap(lines) {
  const assertions = [];
  const notOk = [];
  let plan = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const planMatch = line.match(/^(\d+)\.\.(\d+)$/);
    if (planMatch) {
      plan = Number(planMatch[2]);
      continue;
    }

    const assertMatch = line.match(/^(not ok|ok)\s+(\d+)(?:\s*-\s*(.*))?$/);
    if (assertMatch) {
      const entry = {
        ok: assertMatch[1] === 'ok',
        number: Number(assertMatch[2]),
        description: assertMatch[3] ?? '',
        diagnostics: [],
      };
      assertions.push(entry);
      if (!entry.ok) notOk.push(entry);
      continue;
    }

    // Diagnostics belong to the assertion immediately above them.
    if (line.startsWith('#')) {
      const text = line.replace(/^#\s?/, '');
      const last = assertions[assertions.length - 1];
      if (last && !last.ok) last.diagnostics.push(text);
      continue;
    }
  }

  return { plan, assertions, notOk };
}

async function runSuite(client, source, sink) {
  const statements = splitStatements(source);
  // `sink` is owned by the caller on purpose. If a statement raises, this
  // function exits through the exception, and a results array declared HERE
  // would be discarded with it - losing the TAP that every earlier statement
  // already emitted. That is precisely the information the splitter exists to
  // preserve, so the accumulator must outlive the throw.
  for (const statement of statements) {
    sink.push(await client.query(statement));
  }
  return collectTap(sink);
}

// Running the whole file as one query must produce the same TAP as running it
// statement by statement. If it does, the splitter is proven not to have moved a
// boundary. This is the "prove the tool works" discipline this repository
// requires: a green run on good input is the weaker half of the evidence, so the
// equivalence is asserted rather than assumed.
async function runSuiteWholeFile(client, source) {
  const results = await client.query(source);
  return collectTap(Array.isArray(results) ? results : [results]);
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  const files = readdirSync(testsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log('AVERRA pgTAP runner');
  console.log('  suites found: ' + files.length);

  if (!connectionString) {
    console.log('');
    console.log('SKIP - SUPABASE_DB_URL is not set, so no suite was executed.');
    console.log('  suites executed: 0/' + files.length + ' (a skip, not a pass)');
    if (requireDb) {
      console.error('FAIL - --require-db was given, so a skip is not acceptable.');
      process.exitCode = 1;
    }
    return;
  }

  console.log('  database:     ' + connectionString.replace(/:[^:@/]+@/, ':***@'));

  // pg is not a dependency of the app, so it is imported only when it is needed.
  const { Client } = await import('pg');

  let totalAssertions = 0;
  let totalFailed = 0;
  let suitesRan = 0;
  const failures = [];

  for (const file of files) {
    const path = join(testsDir, file);
    const source = readFileSync(path, 'utf8');

    // A fresh connection per suite. See rule 2 at the top of this file.
    const client = new Client({ connectionString, connectionTimeoutMillis: 30000 });
    let tapLines = [];
    let sqlError = null;
    let splitError = null;

    try {
      await client.connect();
      const rawResults = [];
      try {
        tapLines = await runSuite(client, source, rawResults);
      } catch (error) {
        // The suite aborted, but the statements that already ran still emitted
        // TAP. Recover it from the accumulator rather than reporting nothing.
        tapLines = collectTap(rawResults);
        sqlError = error;
      }

      // Only verify the splitter on a suite that ran cleanly: a suite whose error
      // aborted its transaction cannot produce a comparable whole-file transcript.
      if (verifySplit && !sqlError) {
        try {
          const whole = await runSuiteWholeFile(client, source);
          if (tapLines.join('\n') !== whole.join('\n')) {
            splitError = new Error(
              'statement-by-statement TAP differs from whole-file TAP, so the splitter moved a boundary',
            );
          }
        } catch (error) {
          splitError = error;
        }
      }
    } catch (error) {
      sqlError = sqlError ?? error;
    } finally {
      await client.end().catch(() => {});
    }

    const { plan, assertions, notOk } = parseTap(tapLines);
    suitesRan += 1;
    totalAssertions += assertions.length;
    totalFailed += notOk.length;

    // ---- A suite that produced no assertions is a FAILURE, not a pass. -------
    // Rule 1: `0 bad` out of an empty population is not an assurance.
    const problems = [];
    if (assertions.length === 0) problems.push('produced no assertions at all');
    if (plan === null) {
      problems.push('declared no plan (1..N)');
    } else if (assertions.length !== plan) {
      problems.push('plan is ' + plan + ' but ' + assertions.length + ' assertion(s) ran');
    }
    if (notOk.length > 0) problems.push(notOk.length + ' failed assertion(s)');
    if (sqlError) problems.push('SQL error: ' + sqlError.message);
    if (splitError) problems.push('splitter check: ' + splitError.message);

    console.log('');
    console.log(
      (problems.length === 0 ? 'PASS' : 'FAIL') +
        '  ' +
        file +
        '  -  ok ' +
        (assertions.length - notOk.length) +
        '/' +
        (plan ?? '?') +
        ' (not ok ' +
        notOk.length +
        ')',
    );

    if (verbose) {
      for (const a of assertions) {
        console.log('        ' + (a.ok ? 'ok    ' : 'NOT OK') + ' ' + a.number + ' - ' + a.description);
      }
    }

    if (problems.length > 0) {
      for (const p of problems) console.log('        -> ' + p);
      for (const a of notOk) {
        console.log('        not ok ' + a.number + ' - ' + a.description);
        for (const d of a.diagnostics) console.log('            # ' + d);
      }
      failures.push(file);
    }
  }

  // ---- POPULATION REPORT. Totals are always printed beside the bad count, so a
  // predicate that silently matched nothing is visible rather than invisible. --
  console.log('');
  console.log('---------------------------------------------------------------');
  console.log('  suites executed:   ' + suitesRan + '/' + files.length);
  console.log('  assertions run:    ' + totalAssertions);
  console.log('  assertions failed: ' + totalFailed);
  console.log('  suites failed:     ' + failures.length + '/' + files.length);

  if (failures.length > 0) {
    console.log('');
    for (const file of failures) console.log('  FAIL ' + file);
    console.log('');
    console.log('RESULT: FAIL');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('RESULT: PASS - every suite ran its full plan with no failures.');
}

main().catch((error) => {
  console.error('runner crashed: ' + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});

