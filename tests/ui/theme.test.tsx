import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_THEME_PREFERENCE,
  parseStoredTheme,
  resolveTheme,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

/**
 * The dark theme, and the layer that makes it possible.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH
 *
 * A colour declared in `:root` but absent from `@theme inline` is INVISIBLE. Not
 * broken, not degraded - invisible. Tailwind never saw the name, so `bg-danger-50`
 * compiles to no rule at all, the class renders nothing, and whatever it was
 * painting simply stops being painted. Nothing throws, typecheck passes, lint
 * passes, and every other test passes. The only symptom is a page with a hole in it.
 *
 * The symmetric case is just as quiet: a token in `:root` with no dark override
 * inherits the light value, so that one colour stays stubbornly light while the
 * whole interface around it goes dark. It looks like a deliberate accent.
 *
 * Neither is visible to a behavioural test, because a behavioural test renders one
 * scheme at a time and both schemes produce a valid-looking class. So this suite
 * READS THE STYLESHEET, and - following the rule in AGENTS.md - reports the
 * population beside the bad count, so a predicate that matches nothing cannot read
 * as an assurance.
 */

const CSS_PATH = join(process.cwd(), 'src', 'app', 'globals.css');

/**
 * Comments are stripped BEFORE any analysis.
 *
 * Not for tidiness. This stylesheet documents itself heavily, and a comment that
 * mentions `@theme inline` or writes `var(--color-ink-900)` as an example of what
 * NOT to do is picked up verbatim by a naive scan. Two of these assertions
 * failed exactly that way: the parser found the phrase inside a comment, tried to
 * brace-match from there, and returned the wrong block. A checker that reads the
 * prose is worse than no checker, because it reports a confident answer.
 */
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the first balanced `{...}` block following `header`. */
function blockAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) return '';

  const open = source.indexOf('{', start + header.length - 1);
  if (open < 0) return '';

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * Every balanced block following `header`, concatenated.
 *
 * There is more than one `:root` and more than one `[data-theme='dark']` block in
 * this stylesheet - the scales are grouped for readability. Reading only the first
 * compares 22 tokens and reports the other 24 as if they did not exist, which is
 * the `0 bad` shape again in a new costume.
 *
 * The scan advances to the END of each matched block rather than by a guessed
 * length, so overlapping matches cannot double-count.
 */
function allBlocksAfter(source: string, header: string): string {
  const blocks: string[] = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(header, from);
    if (start < 0) break;

    const open = source.indexOf('{', start + header.length - 1);
    if (open < 0) break;

    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;

    blocks.push(source.slice(open + 1, end));
    from = end + 1;
  }

  return blocks.join('\n');
}

/** Custom property names DECLARED in a block (not referenced). */
function declaredTokens(block: string): Set<string> {
  const names = new Set<string>();
  for (const match of block.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/g)) {
    names.add(match[2] as string);
  }
  return names;
}

/** Custom property names REFERENCED as `var(--x)` anywhere in a block. */
function referencedTokens(block: string): Set<string> {
  const names = new Set<string>();
  for (const match of block.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    names.add(match[1] as string);
  }
  return names;
}

const rootBlock = allBlocksAfter(css, ':root');
const darkBlocks = allBlocksAfter(css, "[data-theme='dark']");
const inlineBlock = blockAfter(css, '@theme inline');

const rawTokens = declaredTokens(rootBlock);
const darkTokens = declaredTokens(darkBlocks);
const mappedTokens = referencedTokens(inlineBlock);

describe('the token layer is complete', () => {
  it('scanned a real population', () => {
    // Guards the guard. An empty `:root` would make every assertion below pass
    // vacuously, which is the `0 bad` failure mode this repository has hit twice.
    // 46 is every token across BOTH `:root` blocks; reading only the first block
    // found 22 and would have reported the other 24 as non-existent.
    expect(rawTokens.size).toBeGreaterThanOrEqual(46);
    expect(darkTokens.size).toBeGreaterThanOrEqual(46);
    expect(mappedTokens.size).toBeGreaterThanOrEqual(46);
  });

  it('finds the two scheme blocks it compares', () => {
    // Without this, `darkTokens` being empty would look like "nothing to flag".
    expect(darkBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('gives every light token a dark value', () => {
    // A token with no dark override keeps its light value forever: one colour
    // stubbornly light in an otherwise dark page, reading as a deliberate accent.
    const missing = [...rawTokens].filter((name) => !darkTokens.has(name));

    expect(
      `${rawTokens.size} tokens, ${missing.length} without a dark value: ${missing.join(', ')}`,
    ).toBe(`${rawTokens.size} tokens, 0 without a dark value: `);
  });

  it('defines no dark value that light does not also have', () => {
    // The reverse drift: a dark-only token renders as nothing at all in light
    // mode, because `var()` on an undefined property resolves to nothing.
    const orphan = [...darkTokens].filter((name) => !rawTokens.has(name));

    expect(`${darkTokens.size} dark, ${orphan.length} orphaned: ${orphan.join(', ')}`).toBe(
      `${darkTokens.size} dark, 0 orphaned: `,
    );
  });

  it('maps every token into the Tailwind colour namespace', () => {
    // THE regression. Unmapped means `bg-<token>` compiles to no rule and the
    // class renders nothing, with no error anywhere in the build.
    const unmapped = [...rawTokens].filter((name) => !mappedTokens.has(name));

    expect(`${rawTokens.size} declared, ${unmapped.length} unmapped: ${unmapped.join(', ')}`).toBe(
      `${rawTokens.size} declared, 0 unmapped: `,
    );
  });

  it('maps nothing that is not declared', () => {
    const dangling = [...mappedTokens].filter((name) => !rawTokens.has(name));

    expect(`${mappedTokens.size} mapped, ${dangling.length} dangling: ${dangling.join(', ')}`).toBe(
      `${mappedTokens.size} mapped, 0 dangling: `,
    );
  });

  it('uses `@theme inline` for the colour layer, not a plain `@theme`', () => {
    // Without `inline`, Tailwind bakes one value per token and the utilities
    // resolve before the dark attribute is ever read. The page would be
    // dark-capable in the stylesheet and identical in practice.
    expect(inlineBlock.length).toBeGreaterThan(100);
    expect(/--color-/.test(blockAfter(css, '@theme {'))).toBe(false);
  });

  it('declares color-scheme in both schemes so native UI follows', () => {
    // Otherwise a dark page keeps a white scrollbar and white form controls.
    expect(rootBlock).toMatch(/color-scheme\s*:\s*light/);
    expect(darkBlocks).toMatch(/color-scheme\s*:\s*dark/);
  });

  it('leaves no hand-written rule reading a --color-* name', () => {
    // `@theme inline` does not EMIT `--color-*` properties, so `var(--color-x)`
    // written by hand resolves to nothing. The raw names are what exist.
    const stray = css.replace(inlineBlock, '').match(/var\(\s*--color-[a-z0-9-]+/g);

    expect(stray ?? []).toEqual([]);
  });
});

describe('resolveTheme is total', () => {
  it.each(THEME_PREFERENCES)('resolves %s to a real scheme under both settings', (pref) => {
    expect(['light', 'dark']).toContain(resolveTheme(pref, false));
    expect(['light', 'dark']).toContain(resolveTheme(pref, true));
  });

  it('lets an explicit choice override the system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('defers to the system only for `system`', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('parseStoredTheme fails closed to system', () => {
  it.each([null, undefined, '', 'purple', 'DARK', 'true', '0', '{"a":1}', 'dark;light'])(
    'treats %o as the default rather than as a preference',
    (input) => {
      // Not to `light`: silently downgrading a user who deliberately chose dark
      // is worse than ignoring a corrupt value, and `system` is the only fallback
      // that can be right for someone who set either of the other two by hand.
      expect(parseStoredTheme(input as string | null)).toBe(DEFAULT_THEME_PREFERENCE);
    },
  );

  it.each(THEME_PREFERENCES)('round-trips the valid preference %s', (pref) => {
    expect(parseStoredTheme(pref)).toBe(pref);
  });

  it('trims before validating, so a stray space is not a rejection', () => {
    // Being forgiving about whitespace is correct here and distinct from being
    // forgiving about garbage: `' light '` still resolves to exactly one of the
    // three declared preferences, whereas `'DARK'` resolves to none of them.
    // Case is NOT forgiven, because an allowlist that matches case-insensitively
    // has quietly become a prefix of a much larger set of accepted strings.
    expect(parseStoredTheme('  dark\n')).toBe('dark');
    expect(parseStoredTheme(' light ')).toBe('light');
    expect(parseStoredTheme('DARK')).toBe(DEFAULT_THEME_PREFERENCE);
  });
});

describe('the bootstrap script agrees with the module', () => {
  it('reads the storage key the module writes', () => {
    // If these drift, the script reads a key nobody writes and every visitor
    // silently gets `system` while the control believes it remembered their
    // choice. Nothing would error.
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it('recognises every preference the module can store', () => {
    for (const pref of THEME_PREFERENCES) {
      expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(pref));
    }
  });

  it('sets the attribute and color-scheme before the body renders', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("setAttribute('data-theme'");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('colorScheme');
  });

  it('consults the OS only for `system`', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("t==='system'&&");
  });

  it('falls back to light rather than leaving the document unthemed', () => {
    // localStorage THROWS in Safari private browsing and in a sandboxed iframe.
    // An exception before the attribute is set leaves the document with no theme
    // at all, which is a worse outcome than ignoring the stored choice.
    expect(THEME_BOOTSTRAP_SCRIPT).toMatch(/\}\s*catch\(_\)\{/);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('catch(_){document.documentElement');
  });

  it('is an expression, not a declaration, so it executes inline', () => {
    // `<script>` runs whatever it is given. A bare `function(){}` would define
    // nothing and the theme would never be applied - with no error.
    const script = THEME_BOOTSTRAP_SCRIPT.trim();
    expect(script.startsWith('(function')).toBe(true);
    expect(script.endsWith('();')).toBe(true);
  });
});
