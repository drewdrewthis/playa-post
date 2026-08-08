import { describe, expect, it } from 'vitest';

import type { Person } from '@playa-post/contracts';

import { summariseGraph, TRUSTED_THRESHOLD } from './graph-counts';

function person(userId: string, degree: number, trust: number | null): Person {
  return { userId, degree, disclosure: 'full', trust };
}

describe('summariseGraph', () => {
  it('counts everybody but the viewer', () => {
    const summary = summariseGraph([
      person('you', 0, null),
      person('a', 1, null),
      person('b', 1, null),
      person('c', 2, null),
    ]);

    expect(summary.people).toBe(3);
  });

  it('counts a person as trusted at the threshold and not below it', () => {
    const summary = summariseGraph([
      person('you', 0, null),
      person('at', 1, TRUSTED_THRESHOLD),
      person('below', 1, TRUSTED_THRESHOLD - 1),
      person('above', 1, 90),
    ]);

    expect(summary.trusted).toBe(2);
  });

  it('reads an unset trust as an absent opinion, not a low one', () => {
    const summary = summariseGraph([
      person('you', 0, null),
      person('unset', 1, null),
      person('zero', 1, 0),
    ]);

    expect(summary).toEqual({ people: 2, trusted: 0 });
  });

  it('summarises a graph with nobody on it', () => {
    expect(summariseGraph([])).toEqual({ people: 0, trusted: 0 });
  });
});
