import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCE,
  nextThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_STORAGE_KEY,
} from './theme-preference';

/**
 * The `unit` vitest project runs in a plain Node environment (no DOM), so there is no
 * real `localStorage` global to exercise. This is an in-memory stand-in for the Web
 * Storage API — a fake at the boundary this module doesn't own, not a mock of code the
 * repo owns.
 */
class InMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/**
 * A stand-in for `matchMedia`, likewise absent from the `unit` project's Node
 * environment. `resolveTheme` only ever reads `matches`, so the rest of
 * `MediaQueryList` is asserted away rather than implemented — a boundary stub, not a
 * mock of code the repo owns.
 */
function stubPrefersDark(matches: boolean): void {
  globalThis.matchMedia = ((query: string) =>
    ({ matches, media: query }) as MediaQueryList) as typeof globalThis.matchMedia;
}

describe('theme preference persistence', () => {
  beforeEach(() => {
    globalThis.localStorage = new InMemoryStorage();
  });

  describe('readStoredThemePreference', () => {
    it('returns the default preference when nothing has been stored', () => {
      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it('defaults to dark', () => {
      expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
    });

    it('returns the stored preference when it holds a valid theme', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'light');

      expect(readStoredThemePreference()).toBe('light');
    });

    it('returns the stored preference when it is "system"', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'system');

      expect(readStoredThemePreference()).toBe('system');
    });

    it('returns the default preference when the stored value is not recognized', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');

      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it('returns the default preference when the stored value is an empty string', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, '');

      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });
  });

  describe('storeThemePreference', () => {
    it('persists the preference under the documented storage key', () => {
      storeThemePreference('light');

      expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('overwrites a previously stored preference', () => {
      storeThemePreference('dark');
      storeThemePreference('system');

      expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    });

    it('round-trips through readStoredThemePreference', () => {
      storeThemePreference('system');

      expect(readStoredThemePreference()).toBe('system');
    });
  });

  describe('resolveTheme', () => {
    it('resolves "light" to itself', () => {
      expect(resolveTheme('light')).toBe('light');
    });

    it('resolves "dark" to itself', () => {
      expect(resolveTheme('dark')).toBe('dark');
    });

    it('resolves "system" to dark when the OS prefers dark', () => {
      stubPrefersDark(true);

      expect(resolveTheme('system')).toBe('dark');
    });

    it('resolves "system" to light when the OS does not prefer dark', () => {
      stubPrefersDark(false);

      expect(resolveTheme('system')).toBe('light');
    });
  });

  describe('nextThemePreference', () => {
    it('cycles light → dark → system → light', () => {
      expect(nextThemePreference('light')).toBe('dark');
      expect(nextThemePreference('dark')).toBe('system');
      expect(nextThemePreference('system')).toBe('light');
    });
  });
});
