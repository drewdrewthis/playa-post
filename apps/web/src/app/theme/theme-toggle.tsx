import type { JSX } from 'react';

import { useTheme } from './theme-provider';

/**
 * The moon/sun button in the app chrome.
 *
 * The glyph shows the theme you would *switch to*, which is the comp's behaviour
 * (`themeIcon: dark ? '☀' : '☾'`) and the convention every OS toggle uses. It is
 * `aria-hidden` because a screen reader announcing "sun" says nothing useful — the
 * accessible name on the button says what pressing it does instead.
 */
export function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const goingDark = theme === 'light';

  return (
    <button
      className="icon-button"
      data-testid="theme-toggle-button"
      type="button"
      aria-pressed={theme === 'dark'}
      aria-label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{goingDark ? '☾' : '☀'}</span>
    </button>
  );
}
