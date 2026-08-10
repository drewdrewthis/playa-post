/** The two resolved themes `tokens.css` selects on — what actually lands on `data-theme`. */
export type Theme = 'light' | 'dark';

/** What a user has chosen: either theme outright, or 'system' to follow the OS. */
export type ThemePreference = Theme | 'system';

/**
 * Where the choice is persisted.
 *
 * ⚠ **This string is duplicated, once, in `apps/web/index.html`.** That copy is the
 * render-blocking script that stamps `data-theme` before the first paint, and it cannot
 * import this module — a module import would run after paint, which is exactly the
 * flash it exists to prevent. Change one and you must change the other.
 */
export const THEME_STORAGE_KEY = 'playapost-theme';

/**
 * Dark, per issue #151 — supersedes issue #43's light default. A first-run user, or one
 * whose storage holds garbage, gets dark unconditionally: 'system' is itself a
 * preference someone opts into, not what nothing-stored falls back to.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The persisted preference, or {@link DEFAULT_THEME_PREFERENCE}.
 *
 * Storage access is guarded because it throws outright in a locked-down browser
 * profile, and a theme preference is never worth failing a mount over.
 */
export function readStoredThemePreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage.getItem(THEME_STORAGE_KEY);

    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persists the choice. Silently a no-op when storage is unavailable — see above. */
export function storeThemePreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Preference not remembered across reloads; the session still honours it.
  }
}

/**
 * The media query 'system' resolves against.
 *
 * Exported so that `ThemeProvider`, which subscribes to the same query for change
 * events, names it rather than repeating the string — a listener watching one query
 * while this function reads another would drift silently, and the symptom would be a
 * theme that only sometimes follows the OS.
 */
export const SYSTEM_DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Resolves a preference to the theme that actually paints.
 *
 * 'light' and 'dark' resolve to themselves; 'system' asks the OS via
 * `prefers-color-scheme`. This is the only place that media query is *read*, so the
 * resolved theme has one source; a caller that needs to know when the OS changes its
 * mind (`ThemeProvider`) subscribes to {@link SYSTEM_DARK_SCHEME_QUERY} and calls back
 * here for the value.
 */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') {
    return preference;
  }

  return globalThis.matchMedia(SYSTEM_DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

const PREFERENCE_AFTER: Readonly<Record<ThemePreference, ThemePreference>> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

/**
 * The next stop in the light → dark → system → light cycle the toggle button walks.
 * A named export, not inlined at the one call site, so the toggle's handler and its
 * accessible label (which announces the stop it is *about* to move to) read off the
 * same cycle rather than two copies that could drift.
 */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return PREFERENCE_AFTER[current];
}

/**
 * Puts the theme on the document, where the token sets in `tokens.css` select on it.
 *
 * The `theme-color` meta tag is updated alongside, because it is what colours the
 * browser's own chrome and the PWA splash — left at one value it renders a light bar
 * above a dark app, which reads as a rendering bug rather than a preference.
 *
 * Takes the *resolved* {@link Theme}, never a {@link ThemePreference} — 'system' has
 * already been turned into 'light' or 'dark' by {@link resolveTheme} before this runs,
 * so `data-theme` and the CSS selectors keyed off it never see a third value.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;

  const meta = document.querySelector('meta[name="theme-color"]');

  meta?.setAttribute('content', theme === 'dark' ? '#120a1a' : '#f6efe2');
}
