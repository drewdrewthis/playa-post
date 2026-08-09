import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasSeenWelcome, markWelcomeSeen, WELCOME_STEPS } from './welcome-steps';

/**
 * In-memory `localStorage`, as `theme-preference.unit.test.ts` builds one: the node
 * test environment has no real Web Storage global to exercise.
 */
class InMemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage {
  getItem(): never {
    throw new Error('storage disabled');
  }

  setItem(): never {
    throw new Error('storage disabled');
  }
}

const realLocalStorage = globalThis.localStorage;

describe('the welcome-seen flag', () => {
  beforeEach(() => {
    globalThis.localStorage = new InMemoryStorage() as unknown as Storage;
  });

  afterEach(() => {
    globalThis.localStorage = realLocalStorage;
  });

  it('is unseen on a fresh device and seen once marked', () => {
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
  });

  it('counts an unreadable storage as seen, so the app stays enterable', () => {
    globalThis.localStorage = new ThrowingStorage() as unknown as Storage;

    expect(hasSeenWelcome()).toBe(true);
    expect(() => {
      markWelcomeSeen();
    }).not.toThrow();
  });
});

describe('the welcome steps', () => {
  it('opens with the comp’s three steps, with the sample query on the search step', () => {
    expect(WELCOME_STEPS).toHaveLength(8);
    expect(WELCOME_STEPS[2]?.code).toBe('type:offer trust:>=60 -truck');
    expect(WELCOME_STEPS.filter((step) => step.code !== null)).toHaveLength(1);
  });

  it('closes by naming all ten principles plus consent, and only there', () => {
    const closing = WELCOME_STEPS.at(-1);
    expect(closing?.principles?.map((principle) => principle.name)).toEqual([
      'Radical Inclusion',
      'Gifting',
      'Decommodification',
      'Radical Self-reliance',
      'Radical Self-expression',
      'Communal Effort',
      'Civic Responsibility',
      'Leaving No Trace',
      'Participation',
      'Immediacy',
      'Consent',
    ]);
    expect(
      WELCOME_STEPS.filter((step) => step.principles !== null),
    ).toEqual([closing]);
  });

  it('glosses every principle, briefly enough to sit two-up on a phone', () => {
    const closing = WELCOME_STEPS.at(-1);
    for (const principle of closing?.principles ?? []) {
      expect(principle.gloss.length).toBeGreaterThan(0);
      expect(principle.gloss.length).toBeLessThanOrEqual(60);
    }
  });
});
