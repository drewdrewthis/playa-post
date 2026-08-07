import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME, readStoredTheme, storeTheme, THEME_STORAGE_KEY } from './theme-preference';

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

describe('theme preference persistence', () => {
  beforeEach(() => {
    globalThis.localStorage = new InMemoryStorage();
  });

  describe('readStoredTheme', () => {
    it('returns the default theme when nothing has been stored', () => {
      expect(readStoredTheme()).toBe(DEFAULT_THEME);
    });

    it('defaults to light', () => {
      expect(DEFAULT_THEME).toBe('light');
    });

    it('returns the stored theme when it holds a valid value', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

      expect(readStoredTheme()).toBe('dark');
    });

    it('returns the default theme when the stored value is not a recognized theme', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');

      expect(readStoredTheme()).toBe(DEFAULT_THEME);
    });

    it('returns the default theme when the stored value is an empty string', () => {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, '');

      expect(readStoredTheme()).toBe(DEFAULT_THEME);
    });
  });

  describe('storeTheme', () => {
    it('persists the theme under the documented storage key', () => {
      storeTheme('dark');

      expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('overwrites a previously stored theme', () => {
      storeTheme('dark');
      storeTheme('light');

      expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('round-trips through readStoredTheme', () => {
      storeTheme('dark');

      expect(readStoredTheme()).toBe('dark');
    });
  });
});
