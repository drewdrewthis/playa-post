import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BULLETIN_TYPE } from '@playa-post/contracts';

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
  // Four steps by owner direction (#214), after feedback that eight was too long.
  // All copy but the roll-call is the owner's wording near-verbatim — snapshots,
  // because "unchanged" is the assertion and any prose diff should be read.
  it('runs four steps: intro, roll-call, offers-and-privacy, values close', () => {
    expect(WELCOME_STEPS).toHaveLength(4);
    expect(WELCOME_STEPS.map((step) => step.title)).toMatchInlineSnapshot(`
      [
        "Your extended family",
        "Ten principles, plus one",
        "Offer, ask, trust",
        "Real people, real trust",
      ]
    `);
    expect(WELCOME_STEPS[0]?.body).toMatchInlineSnapshot(
      `"Your social network is like your extended family: based on trust and made up of good people. Playa Post is a central place to offer gifts to that family and to ask for help."`,
    );
    expect(WELCOME_STEPS[2]?.body).toMatchInlineSnapshot(
      `"Offer events, gatherings, collaborations. A cup of tea or a place to crash. Ask for help if you need it. Everything is private by default, and only people you trust can find you or see your posts."`,
    );
    expect(WELCOME_STEPS[3]?.body).toMatchInlineSnapshot(
      `"Privacy first, always free, always open-source. No ads, no influencers, no noise, no algorithms. Real people, real trust, real connections."`,
    );
  });

  // Names, glosses, and order are all pinned. Every gloss is a claim about something
  // the app does, so a reworded one has to be re-argued here rather than slipped in;
  // the order is Burning Man's published ten with Consent last, not alphabetical.
  it('names all ten principles plus consent on the middle step, glossed, and only there', () => {
    const rollCall = WELCOME_STEPS[1];
    expect(rollCall?.principles).toEqual([
      { name: 'Radical Inclusion', gloss: 'someone who trusts you welcomes you in' },
      { name: 'Gifting', gloss: 'notes and bulletins ask for nothing back' },
      { name: 'Decommodification', gloss: 'no ads, no follower counts, nothing for sale' },
      { name: 'Radical Self-reliance', gloss: 'posts written offline queue and sync when you return' },
      { name: 'Radical Self-expression', gloss: 'your board, your words, six ways to post' },
      { name: 'Communal Effort', gloss: 'the graph is built two people at a time' },
      { name: 'Civic Responsibility', gloss: 'harm can be reported; boards answer to their people' },
      { name: 'Leaving No Trace', gloss: 'expired bulletins leave every board' },
      { name: 'Participation', gloss: 'the board exists because you pin to it' },
      { name: 'Immediacy', gloss: 'here and now, then off the board' },
      { name: 'Consent', gloss: 'nothing is seen beyond the reach its owner set' },
    ]);
    expect(WELCOME_STEPS.filter((step) => step.principles !== null)).toEqual([rollCall]);
  });

  it('the “six ways to post” gloss counts the bulletin-type contract', () => {
    // A seventh postable type turns the gloss into a lie; this is where that lands.
    expect(Object.keys(BULLETIN_TYPE)).toHaveLength(6);
    expect(
      WELCOME_STEPS[1]?.principles?.find(
        (principle) => principle.name === 'Radical Self-expression',
      )?.gloss,
    ).toContain('six ways to post');
  });

  it('glosses every principle, briefly enough to sit two-up on a phone', () => {
    const rollCall = WELCOME_STEPS[1];
    for (const principle of rollCall?.principles ?? []) {
      expect(principle.gloss.length).toBeGreaterThan(0);
      expect(principle.gloss.length).toBeLessThanOrEqual(60);
    }
  });
});
