#!/usr/bin/env node
// Structural validator for PL/pgSQL migrations.
//
// WHY THIS EXISTS
//
// A delimiter COUNT is not a correctness proof. Two independent bugs in this
// repository had an even number of `$$` and an even number of `if`/`end if`
// pairs, while two function bodies were truncated mid-statement and their
// orphaned tails were duplicated at end of file. Counting can be satisfied by a
// truncation plus a duplicate. Only ORDERED PAIRING catches that.
//
// This tool pairs every `create or replace function` declaration with the NEXT
// `$$;` line and fails on:
//   * a function declaration with no closing `$$;` before the next declaration
//   * a `$$;` with no preceding function declaration (orphan close)
//   * a leftover `@@...@@` edit marker
//   * unbalanced `if` / `end if;` inside a function
//
// It is a lint, not a substitute for `supabase test db`. It proves the files are
// plausibly well-formed without a database; it does not prove they execute.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

// SQL-LANGUAGE FUNCTION ORDERING.
//
// PostgreSQL parses and validates a `language sql` function body at CREATE time,
// so a body referencing a table that does not exist yet fails immediately with
// SQLSTATE 42P01. A `language plpgsql` body is not validated until first
// execution, so only SQL-language functions are affected.
//
// This was a real defect: `app.has_capability` referenced `app.admin_users`,
// which was created 65 lines later, and it blocked the entire migration run.
// A structural delimiter check cannot see this, which is why it is checked here.
function checkSqlLanguageOrdering(source, lines, file) {
  const errors = [];

  // Where each table is created, within THIS file. Cross-file references are
  // always safe because files apply in name order.
  const tableLine = new Map();
  lines.forEach((line, index) => {
    const match = line.match(/^\s*create table (?:if not exists )?([A-Za-z_][\w.]*)\s*\(/i);
    if (match) tableLine.set(match[1].toLowerCase(), index + 1);
  });

  if (tableLine.size === 0) return errors;

  const blocks = source.matchAll(
    /create (?:or replace )?function\s+([A-Za-z_][\w.]*)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$\s*;/g,
  );

  for (const block of blocks) {
    const name = block[1];
    const declaration = block[0];

    // Only `language sql` bodies are validated at CREATE time.
    if (!/^\s*language sql\s*$/m.test(declaration)) continue;

    const declLine = source.slice(0, block.index).split(/\r?\n/).length;
    const body = block[2];

    for (const [table, createdAt] of tableLine) {
      if (
        createdAt > declLine &&
        new RegExp(`\\b${table.replace(/\./g, '\\.')}\\b`, 'i').test(body)
      ) {
        errors.push(
          `${name} is language sql and references ${table}, which is not created until line ` +
            `${createdAt} of this file. PostgreSQL validates SQL bodies at CREATE time, so ` +
            `this fails with 42P01. Move the function after the table.`,
        );
      }
    }
  }

  return errors;
}

// TABLE BLOCK INTEGRITY.
//
// A `create table` must reach its own `);`. When a table is truncated mid
// definition, the unclosed parenthesis swallows every following table, so the
// nested `create table` lines become a syntax error (SQLSTATE 42601).
//
// This is a third instance of the truncation class recorded in
// docs/DISCREPANCIES.md (Q-11, and Q-13 for this file): migration 006 lost the
// body of `app.minipay_destination_verifications`, which absorbed three
// subsequent tables. A delimiter COUNT cannot see it, because the swallowed
// tables contribute their own balanced parens.
function checkTableBlocks(lines) {
  const errors = [];
  let inTable = false;
  let currentName = null;
  let startLine = 0;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const open = trimmed.match(/^create table (?:if not exists )?([\w.]+)\s*\(/i);
    if (open && !inTable) {
      inTable = true;
      currentName = open[1];
      startLine = i + 1;
      depth = (trimmed.match(/\(/g) ?? []).length - (trimmed.match(/\)/g) ?? []).length;
      continue;
    }

    if (!inTable) continue;

    depth += (trimmed.match(/\(/g) ?? []).length - (trimmed.match(/\)/g) ?? []).length;

    if (depth === 0 && /^\);?\s*$/.test(trimmed)) {
      inTable = false;
      currentName = null;
    }
  }

  if (inTable) {
    errors.push(
      `create table ${currentName} (line ${startLine}) never closes. Its body was likely ` +
        'truncated, which absorbs the tables that follow it into its parenthesis and ' +
        'produces a syntax error at the next create table.',
    );
  }

  return errors;
}

// GENERATED COLUMN SCOPE.
//
// A generated column expression may only reference columns of ITS OWN row. A
// bare identifier that is not a column of the same table fails at CREATE TABLE
// with SQLSTATE 42703.
//
// This was a real defect: `score_xp bigint generated always as (xp)` referenced
// `xp`, which is a column of app.game_players, not of
// app.game_leaderboard_entries. Nothing structural catches it, because the
// column, the constraint and the index around it were all perfectly well formed.
function checkGeneratedColumnScope(source, lines) {
  const errors = [];

  let tableName = null;
  let columns = new Set();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const open = trimmed.match(/^create table (?:if not exists )?([\w.]+)\s*\(/i);
    if (open) {
      tableName = open[1];
      columns = new Set();
      continue;
    }

    if (!tableName) continue;

    // A column definition at the start of a line inside the current table.
    const column = trimmed.match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
    if (column && !/^(constraint|primary|foreign|unique|check|exclude)$/i.test(column[1])) {
      columns.add(column[1].toLowerCase());
    }

    const generated = trimmed.match(
      /^([a-z_][a-z0-9_]*)\s+.*\bgenerated\s+always\s+as\s*\(([^)]*)\)/i,
    );

    if (generated) {
      const referenced = [...generated[2].matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)].map((m) =>
        m[1].toLowerCase(),
      );

      // Reserved words that appear in an expression without being column
      // references.
      const keywords = new Set([
        'as',
        'generated',
        'always',
        'stored',
        'virtual',
        'coalesce',
        'null',
        'case',
        'when',
        'then',
        'else',
        'end',
        'select',
        'from',
        'where',
        'and',
        'or',
        'not',
        'is',
        'in',
        'cast',
        'array',
        'row',
        'greatest',
        'least',
        'true',
        'false',
      ]);

      for (const name of referenced) {
        if (keywords.has(name)) continue;
        if (columns.has(name)) continue;

        errors.push(
          `${tableName}.${generated[1]} is a generated column referencing "${name}", ` +
            'which is not a column of that table. A generated expression may only ' +
            'reference its own row; use a trigger to derive it from another table.',
        );
      }
    }

    if (/^\);?\s*$/.test(trimmed)) tableName = null;
  }

  return errors;
}

// FILTER ALIAS BINDING.
//
// An aggregate FILTER clause qualifies its predicate with a column reference such
// as `filter (where r.status = 'X')`. If `r` is not bound in the enclosing
// query, PostgreSQL fails with "missing FROM-clause entry for table r" (42P01).
//
// This was a real defect: `public.get_referral_overview` filtered on `r.status`
// while its outer FROM was `from app.referrals` with no alias.
//
// The check is deliberately conservative: an alias counts as bound if it appears
// in ANY from/join clause in the same function body. That can miss a case where
// the alias is bound only in an unrelated subquery, but it cannot produce a false
// positive, which is the direction that matters for a lint.
function checkFilterAliasBinding(source) {
  const errors = [];

  const blocks = source.matchAll(
    /create (?:or replace )?function\s+([A-Za-z_][\w.]*)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$\s*;/g,
  );

  for (const block of blocks) {
    const name = block[1];
    const body = block[2];

    const bound = new Set(
      [...body.matchAll(/(?:from|join)\s+[\w.]+\s+([a-z_][a-z0-9_]*)/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    );

    // Only qualified references inside a FILTER clause are checked, which keeps
    // the rule narrow enough to stay honest.
    for (const filter of body.matchAll(/filter\s*\(\s*where\s+([a-z_][a-z0-9_]*)\s*\./gi)) {
      const alias = filter[1].toLowerCase();

      if (!bound.has(alias)) {
        const line = source.slice(0, block.index).split(/\r?\n/).length;
        errors.push(
          `${name} (line ${line}) uses filter (where ${filter[1]}....) but the alias ` +
            `"${alias}" is never bound by a from or join clause in the function. ` +
            'PostgreSQL will fail this with "missing FROM-clause entry".',
        );
      }
    }
  }

  return errors;
}

function checkFunctionBlocks(lines) {
  const errors = [];
  let open = false;
  let currentName = null;
  let ifCount = 0;
  let endIfCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const decl = trimmed.match(/^create or replace function\s+([\w.]+)/);
    if (decl) {
      if (open) {
        errors.push(`unclosed function ${currentName} before ${decl[1]} (line ${i + 1})`);
      }
      open = true;
      currentName = decl[1];
      ifCount = 0;
      endIfCount = 0;
    }

    if (/^\$\$;/.test(trimmed)) {
      if (!open) {
        errors.push(`orphan $$; with no open function (line ${i + 1})`);
      } else if (ifCount !== endIfCount) {
        errors.push(`${currentName}: unbalanced if/end if (${ifCount} if, ${endIfCount} end if)`);
      }
      open = false;
      currentName = null;
      continue;
    }

    if (open) {
      if (/^if\b/.test(trimmed) && !/^if\s*$/.test(trimmed)) ifCount += 1;
      if (trimmed === 'end if;') endIfCount += 1;
    }
  }

  if (open) {
    errors.push(`unclosed function ${currentName} at end of file`);
  }

  return errors;
}

// OUT PARAMETERS CONFLICTING WITH A SCALAR RETURN TYPE.
//
// PostgreSQL takes the function's result type from its OUT parameters. Declaring
// one alongside a scalar `returns <type>` is a contradiction the server will not
// resolve in the author's favour: it reads the OUT parameter, decides the result
// type is boolean, then rejects the declared uuid with
//
//   ERROR: function result type must be boolean because of OUT parameters
//   SQLSTATE 42P13
//
// This is a real defect, not a style preference. `record_provider_conversion`
// shipped with `p_is_duplicate out boolean` and `returns uuid`, and the whole
// migration run stopped on it after three migrations had already applied.
//
// It is detectable structurally, so it belongs here rather than in the pgTAP
// suites: a gate that needs a database cannot stop a migration that never
// applies. A parameter list containing `out` or `inout` together with a
// `returns` clause is the only way to write this.
//
// The correct fix is either to return a composite type or to return a jsonb
// object. Returning a scalar alongside an OUT parameter cannot work.
function checkOutParameterReturns(source, lines, file) {
  const errors = [];

  // Each `create or replace function` declaration, captured up to its `as $$`.
  const decl = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi;
  let match;

  while ((match = decl.exec(source)) !== null) {
    const name = match[1];

    // Walk the parameter list to its closing paren, tracking nesting so a
    // default value containing a paren cannot end the list early.
    const open = source.indexOf('(', match.index);
    let depth = 0;
    let close = -1;

    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }

    if (close === -1) continue;

    const params = source.slice(open + 1, close);

    if (!/\b(?:out|inout)\s+[A-Za-z_]/i.test(params)) continue;

    // An OUT parameter defines the result type, so `returns setof` or
    // `returns table` is also wrong here: the OUT parameter still wins. Only a
    // bare `returns` with no type is legitimate, and that form is not matched
    // below.
    // `close` is the index OF the closing paren, so the text after it starts with
    // the `)` that terminates the declaration, then the `returns` clause. An
    // earlier version of this check sliced from close+1 and then required a
    // literal `)` in the match, which can never match: it would have passed
    // silently on the exact defect it was written to catch.
    const after = source.slice(close, close + 200);
    const returnsMatch = after.match(/^\s*\)\s*returns\s+(setof\s+)?([\w.]+)/i);

    if (!returnsMatch) continue;

    const outType = params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => /^(?:out|inout)\s+/i.test(p))
      .map((p) =>
        p
          .replace(/^(?:out|inout)\s+/i, '')
          .trim()
          .split(/\s+/)
          .pop(),
      )
      .filter(Boolean);

    if (outType.length !== 1) {
      errors.push(
        `${file}: ${name} declares ${outType.length} OUT parameters with an explicit ` +
          `\`returns ${returnsMatch[2]}\`. A function with OUT parameters takes its result ` +
          `type from those parameters; return a composite type or a single jsonb instead.`,
      );
      continue;
    }

    if (outType[0].toLowerCase() !== returnsMatch[2].toLowerCase()) {
      const line = source.slice(0, close).split(/\r?\n/).length;

      errors.push(
        `${file}:${line}: ${name} declares OUT parameter of type "${outType[0]}" but ` +
          `\`returns ${returnsMatch[2]}\`. PostgreSQL requires the result type to be ` +
          `"${outType[0]}" (SQLSTATE 42P13). Return a composite type or a single jsonb.`,
      );
    }
  }

  return errors;
}

// CROSS-FILE DELEGATE ARITY.
//
// A `public` wrapper that delegates to an `app_private` command is only correct
// if it passes exactly the command's INPUT arguments, by name.
//
// Two real defects in migration 035 were invisible to every other check here:
//
//   1. `create or replace function public.p_deposit_id uuid, p_approver_id uuid`
//      - the name was missing entirely, because pg_get_function_arguments()
//      renders the argument list WITHOUT the function name.
//   2. `select app_private.outbox_backlog(status, event_count)` against a
//      zero-argument function - a RETURNS TABLE(...) function has no input
//      arguments, but proargnames still lists its OUT column names.
//
// Both compile. Both fail at runtime, and the second only when the outbox
// processor calls it. check:migrations reported "0 error(s)" on both.
//
// So this builds a real index of declared input parameters per function across
// all files, then checks each delegate call against it. Schema-qualified calls
// only: an unqualified name could bind to a different overload.
function collectDeclaredFunctions() {
  const index = new Map();

  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const source = readFileSync(join(migrationsDir, file), 'utf8');

    for (const block of source.matchAll(
      /create (?:or replace )?function\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s*\$\$/g,
    )) {
      const [, schema, name, rawParams] = block;

      // Split the parameter list only at depth 0. A naive split(',') breaks
      // inside "numeric(10, 2)" and inside quoted DEFAULT expressions.
      const params = [];
      let depth = 0;
      let inStr = false;
      let cur = '';
      for (let i = 0; i < rawParams.length; i += 1) {
        const ch = rawParams[i];
        if (inStr) {
          cur += ch;
          if (ch === "'") {
            if (rawParams[i + 1] === "'") {
              cur += rawParams[i + 1];
              i += 1;
            } else inStr = false;
          }
          continue;
        }
        if (ch === "'") { inStr = true; cur += ch; continue; }
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { params.push(cur); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) params.push(cur);

      // OUT and INOUT parameters are the result, not inputs, and must not be
      // passed positionally. This is why outbox_backlog() takes no arguments.
      const inputs = params
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => !/^(?:out|inout)\s+/i.test(p))
        .map((p) => p.split(/\s+/)[0]);

      index.set(`${schema}.${name}`.toLowerCase(), {
        file,
        inputs,
      });
    }
  }

  return index;
}

function checkDelegateArity(source, lines, file, declared) {
  const errors = [];

  const blocks = source.matchAll(
    /create (?:or replace )?function\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\$\$([\s\S]*?)\$\$\s*;/g,
  );

  for (const block of blocks) {
    const [, , , , , body] = block;
    if (!body) continue;

    // `select schema.fn(args)` or `perform schema.fn(args)`.
    const calls = body.matchAll(/\b(?:select|perform)\s+([A-Za-z_][\w]*\.[A-Za-z_][\w]*)\s*\(([^()]*)\)/gi);

    for (const call of calls) {
      const qualified = call[1].toLowerCase();
      const target = declared.get(qualified);

      // Not declared in any migration: it may be an extension or pg_catalog
      // function. Silence is correct here; this gate only knows our own code.
      if (!target) continue;

      const passed = call[2]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const line = source.slice(0, block.index + call.index).split(/\r?\n/).length;

      if (passed.length !== target.inputs.length) {
        errors.push(
          `${file}:${line}: calls ${call[1]} with ${passed.length} argument(s) but ` +
            `${target.file} declares ${target.inputs.length} input parameter(s)` +
            (target.inputs.length ? ` (${target.inputs.join(', ')})` : ' (it takes none)') +
            '. This compiles and fails at runtime.',
        );
        continue;
      }

      // Arity alone is not enough, but the name comparison only applies when every
      // argument is a bare identifier. A delegate may legitimately pass an
      // expression (a literal, a concatenation, a column), and comparing that
      // text to a parameter name is meaningless - it produced false positives on
      // two correct calls in migration 012 that pass string literals.
      //
      // So: if any argument is not a simple identifier, the arity check stands
      // alone and the name check is skipped. Names still bind by position, and
      // a wrong count is caught above regardless.
      const allSimple = passed.every((a) => /^[A-Za-z_][\w.]*$/.test(a.replace(/^[*\s]+/, '')));
      if (!allSimple) continue;

      const passedNames = passed.map((a) => a.replace(/^[*\s]+/, '').toLowerCase());
      const expected = target.inputs.map((i) => i.toLowerCase());
      if (passedNames.join(',') !== expected.join(',')) {
        errors.push(
          `${file}:${line}: calls ${call[1]} with (${passedNames.join(', ')}) but ` +
            `${target.file} declares (${expected.join(', ')}). Arguments are passed ` +
            'positionally, so a name or order mismatch silently binds the wrong value.',
        );
      }
    }
  }

  return errors;
}

let totalErrors = 0;
let totalFunctions = 0;

const declaredFunctions = collectDeclaredFunctions();

for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const path = join(migrationsDir, file);
  const source = readFileSync(path, 'utf8');
  const lines = source.split(/\r?\n/);

  const errors = checkFunctionBlocks(lines);
  errors.push(...checkTableBlocks(lines));
  errors.push(...checkGeneratedColumnScope(source, lines));
  errors.push(...checkFilterAliasBinding(source));
  errors.push(...checkSqlLanguageOrdering(source, lines, file));
  errors.push(...checkOutParameterReturns(source, lines, file));
  errors.push(...checkDelegateArity(source, lines, file, declaredFunctions));

  if (/@\w+@@/.test(source)) {
    errors.push('leftover edit marker @@...@@');
  }

  const dolq = (source.match(/\$\$/g) ?? []).length;
  if (dolq % 2 !== 0) {
    errors.push(`odd number of $$ delimiters (${dolq})`);
  }

  const functionCount = (source.match(/^create or replace function/gm) ?? []).length;
  totalFunctions += functionCount;
  totalErrors += errors.length;

  const status = errors.length === 0 ? 'ok' : `FAIL (${errors.length})`;
  console.log(`${file.padEnd(46)} fns=${String(functionCount).padStart(2)} ${status}`);

  for (const error of errors) {
    console.log(`    - ${error}`);
  }
}

console.log(
  `\ncheck-migrations: ${totalErrors === 0 ? 'OK' : 'FAILED'} - ${totalFunctions} functions across all migrations, ${totalErrors} error(s).`,
);

process.exit(totalErrors === 0 ? 0 : 1);
