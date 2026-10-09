/**
 * Light / Dark / System.
 *
 * WHAT IS HERE AND WHY IT IS A SEPARATE MODULE
 *
 * Three things have to agree on the rules: the script that runs before first
 * paint, the React provider that re-renders the control, and the tests. When
 * those rules live in a component, the only way to test the bootstrap is to
 * render a component, and the bootstrap by definition runs before React exists -
 * so the part that decides what the user sees on arrival is the part nobody can
 * test. Hence a pure module, with the script text derived from the constants
 * below rather than written out twice.
 *
 * WHY THE BOOTSTRAP SCRIPT IS INLINE AND IN <head>
 *
 * A theme set after hydration is a theme the user has already seen. The page is
 * server-rendered, so there is a window between first paint and hydration where
 * a script-based fix arrives too late: a dark-mode user gets a white flash, then
 * a dark page. Worse, it is not always a flash - on a warm cache or a slow
 * connection it reads as the site changing its mind.
 *
 * So the attribute is written by a tiny inline script in <head>, before the body
 * renders. It is intentionally duplicated by the provider rather than shared with
 * it: the provider cannot run in time, and a script tag cannot import a module.
 * `tests/ui/theme.test.ts` asserts the two agree.
 *
 * THIS MODULE DECIDES NOTHING ABOUT MONEY OR ACCESS. It is a presentation
 * preference stored in one browser key, readable only by this origin.
 */

/** What the user picked. `system` defers to the operating system. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What `system` resolved to. This is what `data-theme` actually carries. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'averra-theme';

/** Declaration order is presentation order in the control. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** The default for a first-time visitor: follow the OS, never surprise them. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Resolve a preference against the operating system setting.
 *
 * Pure and total: every preference produces a theme, so there is no code path
 * where the page renders with no theme and falls back to whatever the browser
 * guesses.
 */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Interpret a stored value.
 *
 * FAILS CLOSED TO `system`, and specifically not to `light`. localStorage is
 * writable by anything that has run on this origin, survives deploys, and holds
 * values from older versions of this code. An unrecognised or corrupt entry must
 * not leave the page with no theme - and it must not silently override a user who
 * has deliberately chosen dark. `system` is the only fallback that can be
 * correct for someone who set either of the other two by hand.
 */
export function parseStoredTheme(raw: string | null | undefined): ThemePreference {
  if (typeof raw !== 'string') return DEFAULT_THEME_PREFERENCE;
  const value = raw.trim();
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

/** True when the OS is asking for dark. Guarded for a missing `matchMedia`. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * THE BOOTSTRAP SCRIPT.
 *
 * Built from the constants above rather than written as a literal, so a renamed
 * storage key or a fourth preference cannot leave this string agreeing with
 * nothing.
 *
 * Every step is inside one `try`. `localStorage` access throws outright in
 * Safari private browsing and in a sandboxed iframe, and an exception here would
 * abort before `data-theme` is set - leaving the document with NO theme at all,
 * which is a worse outcome than ignoring the user's stored choice. The catch
 * writes light explicitly rather than falling through, so the attribute is always
 * present.
 *
 * It also sets `style.colorScheme`, which drives scrollbars, form controls and
 * the canvas. The stylesheet sets the same thing in CSS; this sets it earlier, so
 * a dark page never paints a white scrollbar first.
 */
export const THEME_BOOTSTRAP_SCRIPT = [
  '(function(){try{',
  `var k=${JSON.stringify(THEME_STORAGE_KEY)},`,
  `p=${JSON.stringify(THEME_PREFERENCES)},`,
  's=window.localStorage.getItem(k),',
  "t=(p.indexOf(s)>-1?s:'system'),",
  "d=t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches),",
  "r=d?'dark':'light',e=document.documentElement;",
  "e.setAttribute('data-theme',r);",
  'e.style.colorScheme=r;',
  "}catch(_){document.documentElement.setAttribute('data-theme','light');}})();",
].join('');
