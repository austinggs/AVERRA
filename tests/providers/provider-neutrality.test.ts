import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// THE NO-HARDCODED-PROVIDER INVARIANT
//
// `src/lib/providers/ingest.ts` used to contain the literal `['event_id',
// 'trans_id']`. `trans_id` is CPX Research's transaction-id placeholder, so one
// vendor's wire format was compiled into the shared ingestion path that EVERY
// provider flows through - the exact coupling law 12 exists to prevent.
//
// The refactor moved those names behind `ProviderAdapter.claimedEventIdFields`, so the
// adapter knows its own format and shared code knows none of them.
//
// WHY A FILE-CONTENT TEST AND NOT A BEHAVIOURAL ONE
//
// A behavioural test ("CPX's id is recorded") passes identically whether the name
// lives in the adapter or is hardcoded in shared code, so it cannot detect a
// regression to the old shape. Reading the source is the only way to assert the
// ABSENCE of a string from a file whose entire job is to be vendor-agnostic.
//
// This is the check AGENTS.md warns about, so it enumerates: it names the files it
// scanned and the patterns it searched, and it asserts the negative on each. A scan
// that silently matched zero files would otherwise read as a pass.

const REPO_ROOT = join(process.cwd());

/**
 * Shared provider code that must stay provider-agnostic.
 *
 * `registry.ts` is held to a WEAKER rule than `ingest.ts`, and the difference is
 * deliberate. The registry's job is to import and register each vendor adapter, so
 * naming a vendor there is correct and unavoidable. What must never appear in either
 * file is a vendor PAYLOAD FIELD NAME - that is what turns shared code into a
 * function of one vendor's wire format.
 */
const SHARED_INGEST_FILE = 'src/lib/providers/ingest.ts';
const SHARED_PROVIDER_FILES = [SHARED_INGEST_FILE, 'src/lib/providers/registry.ts'];

/** Vendor payload field names and credentials. Forbidden in BOTH shared files. */
const VENDOR_PAYLOAD_PATTERNS = [/trans_id/, /subid_1/, /CPX_SECURE_HASH/];

/**
 * Additionally forbidden in the ingestion path, which is where the original defect
 * was. `\bcpx\b` matches the `cpx` in an import path such as `cpx-research`, which is
 * why this pattern is NOT applied to `registry.ts`.
 */
const VENDOR_NAME_PATTERN = /\bcpx\b/i;

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Strips comment lines so a rule about CODE is not failed by a comment that explains
 * why the rule exists. The shared files deliberately still name CPX in prose, and
 * deleting that prose would remove the only record that the refactor was deliberate.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

describe('shared provider ingestion stays provider-neutral', () => {
  it('names no vendor at all in the ingestion path', () => {
    // Populate first, assert second, report the population beside the bad count.
    const code = stripComments(readSource(SHARED_INGEST_FILE));
    const patterns = [...VENDOR_PAYLOAD_PATTERNS, VENDOR_NAME_PATTERN];
    const violations = patterns.filter((pattern) => pattern.test(code));

    expect(`${patterns.length} patterns, ${violations.length} violations`).toBe(
      `${patterns.length} patterns, 0 violations`,
    );
  });

  it('names no vendor payload field in any shared provider file', () => {
    // The registry may import an adapter; it may not know what a postback's fields
    // are called.
    const violations: string[] = [];

    for (const relativePath of SHARED_PROVIDER_FILES) {
      const code = stripComments(readSource(relativePath));

      for (const pattern of VENDOR_PAYLOAD_PATTERNS) {
        if (pattern.test(code)) violations.push(`${relativePath}: ${pattern}`);
      }
    }

    expect(`${SHARED_PROVIDER_FILES.length} files, ${violations.length} violations`).toBe(
      `${SHARED_PROVIDER_FILES.length} files, 0 violations`,
    );
  });

  it('reads event-id aliases from the adapter rather than a literal list', () => {
    // The shape being locked in: `readClaimedEventId` takes the field list as a
    // PARAMETER. `readonly string[]` contains a bracket and is a TYPE, so the
    // assertion targets a literal array - a `[` immediately followed by a quote - which
    // is what re-inlining `['event_id', 'trans_id']` would produce.
    const source = readSource(SHARED_INGEST_FILE);
    const signature = source.match(/function readClaimedEventId\([^)]*\)[\s\S]*?\{/)?.[0];

    expect(signature).toBeDefined();
    expect(signature).toContain('fields');
    expect(signature).not.toMatch(/\[\s*['"]/);
  });

  it('still documents the original defect in the shared file', () => {
    // The comment explaining WHY this refactor happened must survive. Deleting the
    // comment does not fail any behavioural test, and the next person re-adds the
    // array believing it was never tried.
    const source = readSource('src/lib/providers/ingest.ts');
    expect(source).toContain('readClaimedEventId');
    expect(source).toMatch(/adapter declares/i);
  });
});

describe('adapters declare their own event-id aliases', () => {
  it('CPX declares trans_id, and it lives in the adapter', async () => {
    // Behavioural counterpart to the file-content test above: the value the adapter
    // contributes is asserted directly, so a rename that removed the declaration
    // without touching shared code still fails here.
    const { createCpxAdapter } = await import('@/lib/providers/adapters/cpx-research');
    const fields = createCpxAdapter().claimedEventIdFields?.();

    expect(fields).toBeDefined();
    expect(fields).toContain('trans_id');
  });

  it('the reference adapter declares its fixture field', async () => {
    const { createReferenceAdapter } = await import('@/lib/providers/adapters/reference');
    const fields = createReferenceAdapter('secret').claimedEventIdFields?.();

    expect(fields).toContain('event_id');
  });
});