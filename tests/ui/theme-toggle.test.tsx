import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme';

/**
 * The theme control, and the attribute it drives.
 *
 * THE STYLESHEET HALF is covered in theme.test.tsx. This file covers the half that
 * moves: that a click persists, that the attribute actually changes, and that the
 * operating system is listened to rather than consulted once.
 *
 * THE LISTENER IS THE PART WORTH A TEST
 *
 * `resolveTheme` reads `prefers-color-scheme` correctly in a unit test, which
 * proves nothing about what happens at sunset. A visitor on `system` whose OS
 * flips to dark gets nothing unless a `change` listener exists - and the symptom
 * is not an error, it is a page that quietly stopped following the system and
 * looks broken rather than incomplete.
 */

/** A controllable `matchMedia`, since jsdom does not provide a real one. */
function stubMatchMedia(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();

  const query = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => {
      listeners.delete(fn);
    },
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  });

  return {
    setDark(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

/** Clicking the LABEL is what a user does; the input is visually hidden. */
function choose(label: string) {
  fireEvent.click(screen.getByLabelText(label));
}

/** `system` -> `System`, used to reach a radio by its visible text. */
const title = (pref: ThemePreference) => pref[0]!.toUpperCase() + pref.slice(1);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle offers the three real choices', () => {
  it('renders one radio per preference, each with an accessible name', () => {
    stubMatchMedia(false);
    renderToggle();

    expect(screen.getAllByRole('radio')).toHaveLength(3);

    for (const label of ['Light', 'Dark', 'System']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('uses native radios so arrow keys and the checked state come for free', () => {
    // A hand-rolled `role="radio"` group has to re-implement roving tabindex and
    // the "2 of 3" announcement. It gets one of them wrong and fails only for
    // keyboard users, which is exactly who cannot report it.
    stubMatchMedia(false);
    renderToggle();

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('type', 'radio');
      expect(radio.closest('form')).toBeNull();
    }
  });

  it('groups the choices under one accessible legend', () => {
    stubMatchMedia(false);
    const { container } = renderToggle();

    expect(container.querySelector('legend')?.textContent).toMatch(/theme/i);
  });

  it('defaults to System rather than imposing a scheme on a first visit', () => {
    // A visitor who has expressed no preference should be left alone.
    stubMatchMedia(false);
    renderToggle();

    expect(screen.getByLabelText('System')).toBeChecked();
  });
});

describe('choosing a theme persists it and repaints the document', () => {
  it('stores the choice under the key the bootstrap script reads', () => {
    stubMatchMedia(false);
    renderToggle();

    choose('Dark');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('sets data-theme on <html> so the stylesheet switches', () => {
    // The whole mechanism is this attribute. If it does not move, the control
    // updates itself and the page does not change at all - the most convincing
    // possible lie, because the button visibly responds.
    stubMatchMedia(false);
    renderToggle();

    choose('Dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    choose('Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets colorScheme too, so scrollbars and form controls follow', () => {
    stubMatchMedia(false);
    renderToggle();

    choose('Dark');

    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('lets an explicit choice override what the system is saying', () => {
    stubMatchMedia(true);
    renderToggle();

    choose('Light');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('remembers the choice on the next mount', () => {
    stubMatchMedia(false);
    const first = renderToggle();
    choose('Dark');
    first.unmount();

    renderToggle();
    expect(screen.getByLabelText('Dark')).toBeChecked();
  });

  it.each([null, 'purple', 'DARK'] as ReadonlyArray<string | null>)(
    'ignores a corrupt stored value %o rather than rendering a broken control',
    (stored) => {
      stubMatchMedia(false);
      if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);

      renderToggle();

      // Falls back to System, which is a real option - never a control stuck on
      // an option that does not exist.
      expect(screen.getByLabelText('System')).toBeChecked();
    },
  );
});

describe('System follows the operating system, now and later', () => {
  it('starts dark when the system is dark', () => {
    stubMatchMedia(true);
    renderToggle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('re-paints when the system changes while the page is open', () => {
    // THE behaviour. Checked once at load is not the same thing as following it:
    // a `matchMedia` read with no listener means the page ignores the OS until
    // the user reloads, which reads as a bug rather than a missing feature.
    //
    // `act` is required: the OS change arrives from outside React, so the store
    // notification, the re-render and the effect that writes the attribute are
    // all pending until it is flushed.
    const media = stubMatchMedia(false);
    renderToggle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => media.setDark(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => media.setDark(false));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('tells the user what System currently resolved to', () => {
    // Otherwise a visitor looking at a dark page cannot tell whether they chose
    // it or we did, and cannot tell whether changing their OS will change it.
    stubMatchMedia(true);
    renderToggle();

    expect(screen.getByText(/following your device setting \(currently dark\)/i)).toBeVisible();
  });

  it('says plainly that an explicit choice ignores the device', () => {
    stubMatchMedia(true);
    renderToggle();

    choose('Light');

    expect(screen.getByText(/always light, whatever your device is set to/i)).toBeVisible();
  });

  it('ignores an OS change once the user has picked an explicit theme', () => {
    // The behaviour, not the mechanism. An earlier version of this suite asserted
    // that the `matchMedia` subscription was torn down for an explicit choice -
    // an optimisation that reads as an optimisation but tests nothing a user can
    // observe. `useSyncExternalStore` keeps the subscription permanently, because
    // the store has to stay connected to know whether the preference has changed;
    // `readSnapshot` is what decides. So the assertion that matters is the
    // OUTCOME: an OS change must not repaint a page the user pinned.
    const media = stubMatchMedia(false);
    renderToggle();

    choose('Light');

    act(() => media.setDark(true));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByLabelText('Light')).toBeChecked();
  });

  it('still follows the OS after switching back to System', () => {
    // The round trip, which is where a subscription torn down and never restored
    // would leave the user stuck.
    const media = stubMatchMedia(false);
    renderToggle();

    choose('Light');
    act(() => media.setDark(true));
    choose('System');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('ThemeToggle survives a missing provider', () => {
  it('renders rather than throwing, so a wiring mistake is not a blank route', () => {
    // A consumer that throws on an absent provider turns a wiring mistake into a
    // 500, and the wiring mistake is the easier bug to find when it does not throw.
    stubMatchMedia(false);

    expect(() => render(<ThemeToggle />)).not.toThrow();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});

describe('every preference a user can pick is one the module declares', () => {
  it.each(['light', 'dark', 'system'] as ReadonlyArray<ThemePreference>)(
    'round-trips %s through storage and back into the control',
    (pref) => {
      stubMatchMedia(false);
      const first = renderToggle();
      choose(title(pref));
      first.unmount();

      renderToggle();
      expect(screen.getByLabelText(title(pref))).toBeChecked();
    },
  );
});
