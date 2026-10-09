'use client';

import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';
import { useTheme } from './ThemeProvider';
import { cx } from '@/components/ui/Card';

const LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * The Light / Dark / System control.
 *
 * WHY NATIVE RADIO INPUTS RATHER THAN THREE BUTTONS
 *
 * A mutually exclusive choice is a radio group, and the platform already
 * implements one correctly: arrow keys move between the options, only the
 * checked option is a tab stop, and a screen reader announces "2 of 3" plus the
 * state. Building that from `<button role="radio">` means re-implementing roving
 * tabindex, arrow handling and the checked-state announcement by hand - and a
 * hand-rolled version that gets any of it wrong is worse than the plain one,
 * because it looks right in review and fails only for keyboard users.
 *
 * The inputs are visually hidden but NOT `display: none` and NOT `hidden`, because
 * both of those remove them from the accessibility tree and from focus. They are
 * clipped with the standard "visually hidden but focusable" pattern, and the
 * focus ring is drawn on the LABEL, so a keyboard user can still see where they
 * are.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <fieldset className={className}>
      <legend className="sr-only">Colour theme</legend>

      <div className="inline-flex gap-2 rounded-pill bg-surface-sunken p-1">
        {THEME_PREFERENCES.map((option) => {
          const checked = preference === option;

          return (
            <label
              key={option}
              className={cx(
                'relative inline-flex min-h-11 cursor-pointer items-center justify-center rounded-pill px-4 text-sm font-semibold transition-colors',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                checked ? 'bg-surface text-ink-900 shadow-tile' : 'text-ink-500 hover:text-ink-900',
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option}
                checked={checked}
                onChange={() => setPreference(option)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              {LABELS[option]}
            </label>
          );
        })}
      </div>

      {/* Says what "System" actually resolved to. Without it, a visitor on
          `system` who is looking at a dark page has no way to know whether that
          is their choice or ours - and the one thing they may want to know is
          whether changing their OS will change this. */}
      <p className="mt-2 text-xs leading-relaxed text-ink-500">
        {preference === 'system'
          ? `Following your device setting (currently ${resolved}).`
          : `Always ${LABELS[preference].toLowerCase()}, whatever your device is set to.`}
      </p>
    </fieldset>
  );
}
