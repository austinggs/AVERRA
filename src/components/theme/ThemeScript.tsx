import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';

/**
 * Writes `data-theme` before the body renders.
 *
 * Rendered inside <head> by the root layout. See src/lib/theme.ts for why this
 * has to happen here rather than in an effect, and why the text is generated from
 * the module's constants instead of being written out by hand.
 *
 * It is a Server Component: there is no client JavaScript on this path, so the
 * theme is applied even where hydration never completes - a crawler, a failed
 * chunk, or a user who never scrolls. `next/script` with `strategy="beforeScroll"`
 * would be later than this and depends on the bundle, which defeats the point.
 */
export function ThemeScript() {
  return (
    <script
      // The body is a build-time constant from this module, not user input. It
      // reads one key from localStorage and writes two attributes on <html>; there
      // is nothing here to interpolate and nothing here to escape.
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
    />
  );
}
