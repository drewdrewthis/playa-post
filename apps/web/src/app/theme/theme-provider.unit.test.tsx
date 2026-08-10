// @vitest-environment jsdom
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, type Theme } from './theme-preference';
import { ThemeProvider, useTheme } from './theme-provider';
import { ThemeToggle } from './theme-toggle';

/**
 * What the provider owes the document, proven by mounting it.
 *
 * `theme-preference.unit.test.ts` covers the pure pieces — storage, resolution, the
 * cycle — and none of them can see the failure this file exists for: the OS changing
 * its mind puts a value on `data-theme` that React never learns about, and the next tap
 * that resolves to React's *last committed* theme then repaints nothing. The attribute
 * keeps the OS's colour while the button's accessible name announces the other one.
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and this
 * mounts React. Same arrangement as `router.unit.test.tsx`.
 */

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

// React 18 gates `act` on this flag; without it every render logs "The current testing
// environment is not configured to support act(...)" over the assertions.
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The OS's colour scheme, as the provider can see it.
 *
 * A fake for `matchMedia` — the browser API jsdom does not usefully implement — with the
 * one capability the real thing has and every existing stub in this repo lacks: it can
 * *change*, and tell its listeners. This is a boundary the repo does not own, so a fake
 * is the right double.
 */
interface SystemColorScheme {
  /** Flips what the OS reports, then fires `change` at every live listener. */
  changeTo(scheme: Theme): void;
  /** How many listeners are still attached — a leak is visible here after unmount. */
  readonly listenerCount: number;
}

function installSystemColorScheme(initial: Theme): SystemColorScheme {
  let scheme = initial;
  const listeners = new Set<() => void>();

  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches(): boolean {
      return scheme === 'dark';
    },
    media: query,
    addEventListener: (_event: 'change', listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_event: 'change', listener: () => void): void => {
      listeners.delete(listener);
    },
  }));

  return {
    changeTo(next: Theme): void {
      scheme = next;

      for (const listener of [...listeners]) {
        listener();
      }
    },
    get listenerCount(): number {
      return listeners.size;
    },
  };
}

/** Publishes what `useTheme` reports, so the context disagreeing with the document is
 *  something an assertion can catch rather than only a user. */
function ResolvedThemeProbe(): JSX.Element {
  const { theme, preference } = useTheme();

  return <span data-testid="theme-probe" data-preference={preference} data-resolved={theme} />;
}

let mounted: Root | null = null;

async function mountThemedApp(): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);

  mounted = root;
  await act(async () => {
    root.render(
      <ThemeProvider>
        <ThemeToggle />
        <ResolvedThemeProbe />
      </ThemeProvider>,
    );
  });

  return container;
}

/** What the document actually paints — the token sets in `tokens.css` select on this. */
function paintedTheme(): string | undefined {
  return document.documentElement.dataset['theme'];
}

function probe(container: HTMLElement, attribute: 'data-resolved' | 'data-preference'): string {
  return container.querySelector('[data-testid="theme-probe"]')?.getAttribute(attribute) ?? '';
}

async function tapThemeToggle(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="theme-toggle-button"]');

  if (button === null) {
    throw new Error('expected the theme toggle to be mounted');
  }

  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

afterEach(async () => {
  const root = mounted;

  mounted = null;

  if (root !== null) {
    await act(async () => {
      root.unmount();
    });
  }

  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('paints the theme the OS asks for while the preference is "system"', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const os = installSystemColorScheme('light');

    const container = await mountThemedApp();

    expect(paintedTheme()).toBe('light');

    await act(async () => {
      os.changeTo('dark');
    });

    expect(paintedTheme()).toBe('dark');
    // The context is the same fact as the attribute; a consumer reading `theme` must
    // never be told 'light' while the document paints dark.
    expect(probe(container, 'data-resolved')).toBe('dark');
  });

  it('repaints on a tap that lands where the OS had already moved the document', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const os = installSystemColorScheme('light');

    const container = await mountThemedApp();

    await act(async () => {
      os.changeTo('dark');
    });

    expect(paintedTheme()).toBe('dark');

    // 'system' → 'light'. The resolved theme returns to the value it held before the OS
    // moved, which is the trap: a provider whose only writer is an effect keyed on that
    // value has nothing to react to, and the document keeps the OS's dark.
    await tapThemeToggle(container);

    expect(probe(container, 'data-preference')).toBe('light');
    expect(probe(container, 'data-resolved')).toBe('light');
    expect(paintedTheme()).toBe('light');
  });

  it('leaves a pinned preference alone when the OS changes its mind', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const os = installSystemColorScheme('light');

    const container = await mountThemedApp();

    expect(paintedTheme()).toBe('light');

    await act(async () => {
      os.changeTo('dark');
    });

    expect(paintedTheme()).toBe('light');
    expect(probe(container, 'data-resolved')).toBe('light');
  });

  it('cycles light → dark → system → light, painting and persisting each stop', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    installSystemColorScheme('dark');

    const container = await mountThemedApp();

    await tapThemeToggle(container);

    expect(probe(container, 'data-preference')).toBe('dark');
    expect(paintedTheme()).toBe('dark');
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await tapThemeToggle(container);

    expect(probe(container, 'data-preference')).toBe('system');
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    // The OS prefers dark here, so 'system' resolves to dark — the stop changed even
    // though the painted theme did not.
    expect(paintedTheme()).toBe('dark');

    await tapThemeToggle(container);

    expect(probe(container, 'data-preference')).toBe('light');
    expect(paintedTheme()).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('picks up an OS change that happened while a pinned preference was ignoring it', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const os = installSystemColorScheme('dark');

    const container = await mountThemedApp();

    // The OS moves to light while the pinned 'dark' preference is deliberately deaf to
    // it. Cycling on to 'system' must honour where the OS is *now*, not where it was.
    await act(async () => {
      os.changeTo('light');
    });

    expect(paintedTheme()).toBe('dark');

    await tapThemeToggle(container);

    expect(probe(container, 'data-preference')).toBe('system');
    expect(paintedTheme()).toBe('light');
  });

  it('stops listening to the OS once it unmounts', async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const os = installSystemColorScheme('light');

    await mountThemedApp();

    expect(os.listenerCount).toBeGreaterThan(0);

    const root = mounted;

    mounted = null;

    await act(async () => {
      root?.unmount();
    });

    expect(os.listenerCount).toBe(0);
  });
});
