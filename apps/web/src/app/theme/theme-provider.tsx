import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import {
  applyTheme,
  nextThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  type Theme,
  type ThemePreference,
} from './theme-preference';

/**
 * What a consumer of {@link useTheme} gets: the resolved theme (what's actually
 * painted), the raw preference behind it (which may be 'system'), and the way to cycle
 * the preference.
 */
export interface ThemeControls {
  readonly theme: Theme;
  readonly preference: ThemePreference;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeControls | null>(null);

/**
 * Holds the theme preference and keeps the document in sync with its resolved theme.
 *
 * Three preferences, per issue #151 (supersedes #43's light-only default): 'light',
 * 'dark', or 'system'. The comp's own mechanism is still a button that writes
 * `localStorage['playapost-theme']` — this only widens what it can write, and a network
 * built for a place with no lighting still has a real reason to let someone pin dark
 * (or light) regardless of what the OS says.
 *
 * `useLayoutEffect` rather than `useEffect` for the paint itself, so the attribute lands
 * in the same frame as the render that changed it — with `useEffect` the toggle paints
 * one frame of the old palette. First paint is handled earlier still, by the inline
 * script in `index.html`; this provider only has to keep up with changes after mount.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference);
  const theme = resolveTheme(preference);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Live-follows the OS only while the stored preference is 'system' — a pinned 'light'
  // or 'dark' preference must never repaint just because the OS changed its mind.
  useEffect(() => {
    if (preference !== 'system') {
      return undefined;
    }

    const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyTheme(resolveTheme('system'));
    };

    query.addEventListener('change', onChange);

    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [preference]);

  const toggleTheme = useCallback(() => {
    setPreference((current) => {
      const next = nextThemePreference(current);

      storeThemePreference(next);

      return next;
    });
  }, []);

  const controls = useMemo<ThemeControls>(
    () => ({ theme, preference, toggleTheme }),
    [theme, preference, toggleTheme],
  );

  return <ThemeContext.Provider value={controls}>{children}</ThemeContext.Provider>;
}

/** The resolved theme, its preference, and the way to cycle it, from anywhere inside
 *  {@link ThemeProvider}. */
export function useTheme(): ThemeControls {
  const controls = useContext(ThemeContext);

  if (controls === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }

  return controls;
}
