import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { applyTheme, readStoredTheme, storeTheme, type Theme } from './theme-preference';

/** What a consumer of {@link useTheme} gets: the current theme and the way to flip it. */
export interface ThemeControls {
  readonly theme: Theme;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeControls | null>(null);

/**
 * Holds the light/dark choice and keeps the document in sync with it.
 *
 * An explicit toggle, not `prefers-color-scheme`: the comp's own mechanism is a button
 * that writes `localStorage['playapost-theme']`, and a network built for a place with no
 * lighting has a real reason to let someone choose dark at noon.
 *
 * `useLayoutEffect` rather than `useEffect` so the attribute lands in the same frame as
 * the render that changed it — with `useEffect` the toggle paints one frame of the old
 * palette. First paint is handled earlier still, by the inline script in `index.html`;
 * this provider only has to keep up with changes after mount.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';

      storeTheme(next);

      return next;
    });
  }, []);

  const controls = useMemo<ThemeControls>(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={controls}>{children}</ThemeContext.Provider>;
}

/** The theme and its toggle, from anywhere inside {@link ThemeProvider}. */
export function useTheme(): ThemeControls {
  const controls = useContext(ThemeContext);

  if (controls === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }

  return controls;
}
