import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import {
  applyTheme,
  nextThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  SYSTEM_DARK_SCHEME_QUERY,
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
 * Subscribes React to the OS colour scheme.
 *
 * Module-level so its identity is stable — `useSyncExternalStore` tears the subscription
 * down and rebuilds it whenever this function changes.
 */
function subscribeToSystemTheme(onSchemeChange: () => void): () => void {
  const query = globalThis.matchMedia(SYSTEM_DARK_SCHEME_QUERY);

  query.addEventListener('change', onSchemeChange);

  return () => {
    query.removeEventListener('change', onSchemeChange);
  };
}

/** What the OS is asking for right now. A primitive, so React's snapshot comparison is
 *  stable across calls and never loops. */
function readSystemTheme(): Theme {
  return resolveTheme('system');
}

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
 *
 * ⚠ **That layout effect is the only writer of `data-theme`.** The OS's scheme reaches it
 * as React state, through `useSyncExternalStore`, rather than being painted straight from
 * a `matchMedia` listener: a listener that writes the document behind React's back leaves
 * the committed `theme` stale, and the next tap resolving to that stale value changes no
 * dependency — so the effect never runs and the document keeps the OS's colour while the
 * button announces the other one.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme);
  // A pinned 'light' or 'dark' never repaints because the OS changed its mind: that
  // guarantee lives in this line, not in a conditional subscription. Keeping the
  // subscription unconditional is what lets a preference cycled back to 'system' resolve
  // against where the OS is *now*, rather than where it was when we stopped listening.
  const theme: Theme = preference === 'system' ? systemTheme : preference;

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
