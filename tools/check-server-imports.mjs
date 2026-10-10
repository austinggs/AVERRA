// =============================================================================
// check-server-imports.mjs
//
// A `'use client'` module exports CLIENT REFERENCES. Rendering one is legal and is
// how the App Router works. CALLING one from a Server Component throws at render
// time:
//
//   Attempted to call pillTabPanelId() from the server but pillTabPanelId is on
//   the client. It's not possible to invoke a client function from the server, it
//   can only be rendered as a Component or passed to props of a Client Component.
//
// This shipped as a live defect in CR-0040. `PillTabs.tsx` is a client module and
// exported two pure id helpers; the earn page is a Server Component and needed the
// matching `aria-labelledby`, so it imported them from there and called them. Every
// build passed - tsc, eslint, vitest and `next build` all accepted it - and the page
// threw only on render. That gap is why this gate exists: four tools resolve the
// module correctly and the browser is the one that executes it.
//
// WHY THE RULE IS "CALLS IT", NOT "IMPORTS IT"
//
// Importing a client reference is not the bug. `<PillTabs />` imported from a client
// module into a Server Component is the intended pattern, and a gate that failed on
// it would be unusable within one commit. So the rule is narrow: a non-client module
// imports a name from a client module AND CALLS it. That is unambiguous, and it
// always crashes.
//
// PascalCase names are skipped. A component is PascalCase by convention, and calling
// one as a plain function is a different, rarer defect; folding it in here would mix
// two rules and make this one noisier.
//
// WHAT IT DOES NOT DO - read before trusting a green run
//
//   * It is not a module-graph analysis. A non-client module that is only ever
//     imported FROM client modules is itself in the client graph, and calling a
//     client reference from it works. This gate flags that too. The fix is the same
//     either way: a pure value belongs in a module with no directive regardless.
//
//   * It does not detect the inverse mistake, a client module re-exporting a server
//     value (`export { x } from './pure'`) and re-wrapping it as a client reference.
//     That IS caught, but only downstream: when a Server Component calls the
//     re-exported name, this gate fires on that call site.
//
//   * It cannot see a dynamic import, a barrel that hides the origin, or a value
//     passed through props.
//
// DELIBERATELY TREATED AS SAFE
//
//   * `import type { X }` and `import { type X }` - erased at compile time, so they
//     cross the boundary as nothing. Flagging them would be pure noise: every Server
//     Component types its props this way.
//   * Rendering a client component as JSX, the pattern this gate exists to protect.
//
// Like every other gate here it prints its population beside its bad count, because
// a predicate that silently matches nothing is indistinguishable from a clean result.
// It also refuses to pass when it finds no client modules at all.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Where `@/` points. Kept in one place so the alias cannot drift. */
const ALIAS = '@/';

/** Extensions tried when resolving an extensionless import. */
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * Blank comments and string bodies, preserving length and newlines.
 *
 * So a call inside a comment, or a name that merely appears in prose, is not
 * mistaken for a call. Offsets stay valid, which is what makes the reported line
 * number trustworthy.
 *
 * Single quotes are deliberately NOT masked: an apostrophe in JSX prose (`don't`)
 * would open a string that never closes and blank the rest of the file. Every real
 * call in this repository is handled correctly without it.
 */
function maskCommentsAndStrings(source) {
  const out = source.split('');
  const len = source.length;
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < len) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? len : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      let stop = source.indexOf('\n', i);
      if (stop === -1) stop = len;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '`' || ch === '"') {
      let stop = i + 1;
      while (stop < len) {
        if (source[stop] === '\\') {
          stop += 2;
          continue;
        }
        if (source[stop] === ch || source[stop] === '\n') break;
        stop += 1;
      }
      const end = Math.min(stop + 1, len);
      blank(i, end);
      i = end;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/**
 * True when the file OPENS with the `'use client'` directive.
 *
 * A directive buried mid-file does nothing at all, so treating one as a client
 * module would let a real violation hide behind it.
 */
function isClientModule(source) {
  return /^\uFEFF?\s*(['"])use client\1\s*;?/.test(source);
}

/** Resolve an import specifier to a file under `src`, or null. */
function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith(ALIAS)) {
    base = join(SRC, specifier.slice(ALIAS.length));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // A bare specifier is a package. Nothing local is reachable through one, and
    // walking node_modules is not this gate's job.
    return null;
  }

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next suffix.
    }
  }

  return null;
}

/**
 * One import statement: its module plus the local names it binds.
 *
 * `named` excludes type-only bindings - both `import type { X } from` and
 * `import { type X } from` erase at compile time.
 */
function readImports(source) {
  const pattern = /\bimport\s+([\s\S]*?)\s*from\s*(['"`])([^'"`]+)\2/g;
  const statements = [];

  for (const match of source.matchAll(pattern)) {
    const body = match[1] || '';
    const specifier = match[3];
    if (body.trim() === '') continue;

    const namespace = body.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1] ?? null;
    const named = [];
    const braces = body.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const piece = part.trim();
        if (piece === '' || /^type\s/.test(piece)) continue;
        const local = piece
          .split(/\s+as\s+/)
          .pop()
          .trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) named.push(local);
      }
    }

    statements.push({ specifier, namespace, named });
  }

  return statements;
}

function lineOf(maskedSource, index) {
  return maskedSource.slice(0, index).split('\n').length;
}

const files = walk(SRC);
if (files.length === 0) {
  console.error('check-server-imports: no source files under src/, refusing to pass vacuously');
  process.exit(1);
}

const clientFiles = files.filter((file) => isClientModule(readFileSync(file, 'utf8')));

if (clientFiles.length === 0) {
  // The empty-population failure this repository has already paid for three times.
  // A detector that matches nothing reports `0 bad`, and `0 bad` reads as an
  // assurance. Refuse to emit one.
  console.error('check-server-imports: found 0 client modules in src/.');
  console.error('Either the detector has broken or every module lost its directive.');
  console.error('Refusing to report `0 bad` from an empty population.');
  process.exit(1);
}

const clientSet = new Set(clientFiles);
const violations = [];
let importsChecked = 0;

for (const file of files) {
  if (clientSet.has(file)) continue;

  const source = readFileSync(file, 'utf8');
  const masked = maskCommentsAndStrings(source);

  for (const statement of readImports(source)) {
    const origin = resolveImport(file, statement.specifier);
    if (!origin || !clientSet.has(origin)) continue;
    importsChecked += 1;

    // `import * as ns` - any lowercase member call reaches a client reference.
    if (statement.namespace) {
      const member = new RegExp(
        `(?<![\\w$.])${escapeRegExp(statement.namespace)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,
        'g',
      );
      for (const hit of masked.matchAll(member)) {
        if (/^[A-Z]/.test(hit[1])) continue;
        violations.push({
          file,
          line: lineOf(masked, hit.index),
          local: `${statement.namespace}.${hit[1]}`,
          origin,
        });
      }
    }

    for (const local of statement.named) {
      // A component is PascalCase. See the header note on why the two rules are
      // deliberately not merged.
      if (/^[A-Z]/.test(local)) continue;

      // `(?<![\w$.])` excludes `obj.helper(` and `somehelper(`. The lookahead-free
      // prefix matters because a naive substring match here would flag every
      // property access of a same-named method.
      const call = new RegExp(`(?<![\\w$.])${escapeRegExp(local)}\\s*\\(`, 'g');
      for (const hit of masked.matchAll(call)) {
        violations.push({ file, line: lineOf(masked, hit.index), local, origin });
      }
    }
  }
}

console.log(
  `check-server-imports: ${clientFiles.length} client modules, ${files.length} source files scanned, ` +
    `${importsChecked} server-to-client imports inspected, ${violations.length} called`,
);

if (violations.length > 0) {
  console.error('');
  console.error(
    `check-server-imports: ${violations.length} client reference(s) CALLED from a server module\n`,
  );

  for (const v of violations) {
    console.error(`  ${relative(ROOT, v.file)}:${v.line}  ${v.local}()`);
    console.error(`    imported from ${relative(ROOT, v.origin)}, which has 'use client'`);
  }

  console.error('');
  console.error("A value exported from a 'use client' module is a CLIENT REFERENCE once it");
  console.error('reaches a Server Component. Rendering one as a component is legal.');
  console.error('CALLING one throws "Attempted to call x() from the server".');
  console.error('');
  console.error("Move the function to a module with no 'use client' directive - see");
  console.error('src/components/ui/pillTabIds.ts - and import it from there.');
  console.error('Typecheck, lint, vitest and `next build` all accept this defect.');
  console.error('');
  process.exit(1);
}

console.log('check-server-imports: OK - no client reference is called from a server module');
