/** The two themes the design comp defines. There is no "system" third option. */
export type Theme = 'light' | 'dark';

/**
 * Where the choice is persisted.
 *
 * ⚠ **This string is duplicated, once, in `apps/web/index.html`.** That copy is the
 * render-blocking script that stamps `data-theme` before the first paint, and it cannot
 * import this module — a module import would run after paint, which is exactly the
 * flash it exists to prevent. Change one and you must change the other.
 */
export const THEME_STORAGE_KEY = 'playapost-theme';

/** Light, per issue #43 — a first-run user gets the comp's default, not the OS's. */
export const DEFAULT_THEME: Theme = 'light';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

/**
 * The persisted choice, or {@link DEFAULT_THEME}.
 *
 * Storage access is guarded because it throws outright in a locked-down browser
 * profile, and a theme preference is never worth failing a mount over.
 */
export function readStoredTheme(): Theme {
  try {
    const stored = globalThis.localStorage.getItem(THEME_STORAGE_KEY);

    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Persists the choice. Silently a no-op when storage is unavailable — see above. */
export function storeTheme(theme: Theme): void {
  try {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Preference not remembered across reloads; the session still honours it.
  }
}

/**
 * Puts the theme on the document, where the token sets in `tokens.css` select on it.
 *
 * The `theme-color` meta tag is updated alongside, because it is what colours the
 * browser's own chrome and the PWA splash — left at one value it renders a light bar
 * above a dark app, which reads as a rendering bug rather than a preference.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;

  const meta = document.querySelector('meta[name="theme-color"]');

  meta?.setAttribute('content', theme === 'dark' ? '#120a1a' : '#f6efe2');
}
