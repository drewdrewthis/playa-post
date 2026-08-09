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
  it('carries eight steps: the comp’s three, four themed, one closing roll-call', () => {
    expect(WELCOME_STEPS).toHaveLength(8);
    expect(WELCOME_STEPS[2]?.code).toBe('type:offer trust:>=60 -truck');
    expect(WELCOME_STEPS.filter((step) => step.code !== null)).toHaveLength(1);
  });

  // The comp-fidelity guard. The five steps after these are ours to reword, but the
  // first three are `design/Playa Post.dc.html`'s `obSteps` verbatim — a snapshot,
  // because "unchanged" is the whole assertion and any prose diff should be read.
  it('opens with the comp’s three steps, word for word', () => {
    expect(WELCOME_STEPS.slice(0, 3)).toMatchInlineSnapshot(`
      [
        {
          "body": "People join by invitation and consent. Trust is a private 0–100 dial, directional, and visible only to you. Pan and zoom — clusters form around the people you trust.",
          "code": null,
          "icon": "◉",
          "principles": null,
          "title": "Your graph is yours",
        },
        {
          "body": "Offers, requests, events, collabs, thanks, intros. They expire. To reach someone, pin a note to their board — there is no inbox.",
          "code": null,
          "icon": "▤",
          "principles": null,
          "title": "Short, typed bulletins",
        },
        {
          "body": "The board speaks a tiny query language. Save any search as a view and get pinged when new bulletins match.",
          "code": "type:offer trust:>=60 -truck",
          "icon": "⌕",
          "principles": null,
          "title": "Search like a local",
        },
      ]
    `);
  });

  // Names, glosses, and order are all pinned. Every gloss is a claim about something
  // the app does, so a reworded one has to be re-argued here rather than slipped in;
  // the order is Burning Man's published ten with Consent last, not alphabetical.
  it('closes by naming all ten principles plus consent, glossed, and only there', () => {
    const closing = WELCOME_STEPS.at(-1);
    expect(closing?.principles).toEqual([
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
    expect(
      WELCOME_STEPS.filter((step) => step.principles !== null),
    ).toEqual([closing]);
  });

  it('the “six ways to post” gloss counts the bulletin-type contract', () => {
    // A seventh postable type turns the gloss into a lie; this is where that lands.
    expect(Object.keys(BULLETIN_TYPE)).toHaveLength(6);
    expect(
      WELCOME_STEPS.at(-1)?.principles?.find(
        (principle) => principle.name === 'Radical Self-expression',
      )?.gloss,
    ).toContain('six ways to post');
  });

  it('glosses every principle, briefly enough to sit two-up on a phone', () => {
    const closing = WELCOME_STEPS.at(-1);
    for (const principle of closing?.principles ?? []) {
      expect(principle.gloss.length).toBeGreaterThan(0);
      expect(principle.gloss.length).toBeLessThanOrEqual(60);
    }
  });
});
