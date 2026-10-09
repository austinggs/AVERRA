'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_THEME_PREFERENCE,
  parseStoredTheme,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

interface ThemeContextValue extends ThemeSnapshot {
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The theme preference IS AN EXTERNAL STORE - two of them, in fact:
 * `localStorage` for the choice and `matchMedia` for what the OS wants. Neither
 * lives in React, and both can change without anything in the tree asking.
 *
 * So it is read with `useSyncExternalStore` rather than mirrored into `useState`
 * and reconciled by an effect. That is not a style preference, it removes two real
 * defects the `useState` version had:
 *
 *   1. SYNCHRONISING AN EXTERNAL STORE THROUGH AN EFFECT IS A CASCADING RENDER.
 *      On mount React would render, the effect would call setState, and React
 *      would render again - twice before the user had done anything. The compiler
 *      lint rule `react-hooks/set-state-in-effect` rejects exactly this shape.
 *   2. THE STORE AND THE VIEW COULD DISAGREE. An earlier version updated React
 *      state in the `matchMedia` handler but re-applied `data-theme` only in the
 *      preference effect, so an OS change at sunset updated the caption under the
 *      control and left the page light. Reading the store directly means there is
 *      no second copy to fall behind: the attribute is applied from a value React
 *      rendered from, in one place.
 *
 * `getSnapshot` MUST return a stable reference while nothing has changed, so the
 * module keeps a cache instead of building a fresh object per call - returning a
 * new object every time is the classic way to hang this hook in a render loop.
 */
let cached: ThemeSnapshot | null = null;

/** Listeners notified when the stored preference changes from inside this tab. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Safari private browsing and sandboxed iframes throw here. A theme that
    // cannot be persisted must read as "not chosen", not as a crash.
    return null;
  }
}

function readSnapshot(): ThemeSnapshot {
  const preference = parseStoredTheme(readStored());
  const resolved = resolveTheme(preference, systemPrefersDark());

  if (cached && cached.preference === preference && cached.resolved === resolved) {
    return cached;
  }

  cached = { preference, resolved };
  return cached;
}

/** What the server rendered, and what hydration starts from. */
const SERVER_SNAPSHOT: ThemeSnapshot = {
  preference: DEFAULT_THEME_PREFERENCE,
  resolved: 'light',
};

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  // The OS flipping its setting at sunset is the whole point of `system`.
  media?.addEventListener('change', onStoreChange);

  // Another tab changing the preference. Not a nicety: a user with Averra open in
  // two windows would otherwise see one of them silently keep the old theme.
  window.addEventListener('storage', onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    media?.removeEventListener('change', onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

/**
 * Holds the theme preference and keeps `data-theme` in step with it.
 *
 * There is no React state here at all: the preference and the resolved scheme both
 * come from the store, and the single effect writes to the DOM. Effects are for
 * synchronising outward, and this one does exactly that and nothing else.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { preference, resolved } = useSyncExternalStore(
    subscribe,
    readSnapshot,
    () => SERVER_SNAPSHOT,
  );

  // The one synchronisation effect, and it has no setState in it: the rendered
  // value goes straight to the document. This is also what makes the attribute
  // follow an OS change - the store re-renders with a new `resolved`, this runs,
  // and the page repaints.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A write can throw (private browsing, a full quota). The theme the user
      // picked should still apply for this session, so the failure is swallowed
      // rather than being allowed to undo the click.
    }
    notify();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The provider, or a working no-op when it is absent.
 *
 * Every consumer uses this rather than `useContext` directly, because a missing
 * provider should degrade to "always light" and not crash a page. A component
 * that throws on an absent provider turns a wiring mistake into a blank route,
 * and the wiring mistake is the easier bug to find when it does not throw.
 */
export function useTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      preference: DEFAULT_THEME_PREFERENCE,
      resolved: 'light',
      setPreference: () => {},
    }
  );
}
