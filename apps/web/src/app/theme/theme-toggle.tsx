import type { JSX } from 'react';

import { nextThemePreference, type ThemePreference } from './theme-preference';
import { useTheme } from './theme-provider';

/** The glyph for each preference — light/dark keep the comp's sun/moon; system gets a
 *  half-shaded circle, the common "follows the OS" mark. Glyphs only, no new colour. */
const GLYPH: Readonly<Record<ThemePreference, string>> = {
  light: '☀',
  dark: '☾',
  system: '◐',
};

/**
 * The theme button in the app chrome.
 *
 * Cycles light → dark → system → light (issue #151, which also flips the *default*
 * preference to dark — see `theme-preference.ts`). The glyph shows the current
 * preference rather than the old two-state "shows what you'd switch to," because with
 * three stops that convention stops being enough information on its own. `aria-pressed`
 * has no true/false shape for a three-state control, so the accessible name carries the
 * whole state instead — current preference and the stop one tap away.
 */
export function ThemeToggle(): JSX.Element {
  const { preference, toggleTheme } = useTheme();
  const next = nextThemePreference(preference);

  return (
    <button
      className="icon-button"
      data-testid="theme-toggle-button"
      type="button"
      aria-label={`Theme: ${preference} — tap for ${next}`}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{GLYPH[preference]}</span>
    </button>
  );
}
