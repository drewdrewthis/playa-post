import { describe, expect, it } from 'vitest';

import type { Graph, Person } from '@playa-post/contracts';

import { connectionsAndBulletinsLine, describePersonContext } from './person-context';

/**
 * The derived context block (issue #85): what the degree line says, and what counts as
 * a mutual — all computed from a `graph.list` payload, nothing fetched.
 */

function person(userId: string, degree: number, displayName?: string): Person {
  return {
    userId,
    degree,
    disclosure: displayName === undefined ? 'topology_only' : 'full',
    ...(displayName === undefined ? {} : { displayName }),
    trust: null,
  };
}

function edge(personAId: string, personBId: string): Graph['edges'][number] {
  return { personAId, personBId };
}

/**
 * viewer — moss — kiki, viewer — birdie — kiki: Kiki at the second degree with two
 * vias; theo at the third, behind Kiki.
 */
const GRAPH: Graph = {
  people: [
    person('viewer', 0, 'Rae'),
    person('moss', 1, 'Moss'),
    person('birdie', 1, 'Birdie'),
    person('kiki', 2),
    person('theo', 3),
  ],
  edges: [
    edge('moss', 'viewer'),
    edge('birdie', 'viewer'),
    edge('kiki', 'moss'),
    edge('birdie', 'kiki'),
    edge('kiki', 'theo'),
  ],
};

describe('the degree line', () => {
  it('reads "connected to you" at the first degree', () => {
    expect(describePersonContext(person('moss', 1, 'Moss'), GRAPH).degreeLine).toBe(
      '1st degree · connected to you',
    );
  });

  it('names every via at the second degree', () => {
    expect(describePersonContext(person('kiki', 2), GRAPH).degreeLine).toBe(
      '2nd degree · via Moss + Birdie',
    );
  });

  /*
   * ⚠ Vias are direct connections and so arrive `full` in practice — but the line must
   * survive a payload that withheld the name, with no id-derived placeholder (the
   * `person-identity.tsx` rule).
   */
  it('drops the via clause rather than inventing a name for an undisclosed via', () => {
    const withheldVia: Graph = {
      people: [person('viewer', 0, 'Rae'), person('moss', 1), person('kiki', 2)],
      edges: [edge('moss', 'viewer'), edge('kiki', 'moss')],
    };

    expect(describePersonContext(person('kiki', 2), withheldVia).degreeLine).toBe('2nd degree');
  });

  // The comp writes a via chain here, but past the second degree every intermediary is
  // `topology_only`: the ordinal stands alone.
  it('is the bare ordinal from the third degree out', () => {
    expect(describePersonContext(person('theo', 3), GRAPH).degreeLine).toBe('3rd degree');
    expect(describePersonContext(person('far', 6), GRAPH).degreeLine).toBe('6th degree');
  });

  it('spells the teens right', () => {
    expect(describePersonContext(person('far', 11), GRAPH).degreeLine).toBe('11th degree');
    expect(describePersonContext(person('far', 12), GRAPH).degreeLine).toBe('12th degree');
    expect(describePersonContext(person('far', 13), GRAPH).degreeLine).toBe('13th degree');
    expect(describePersonContext(person('far', 21), GRAPH).degreeLine).toBe('21st degree');
  });
});

describe('the mutual-connection count', () => {
  it('counts the people on an edge with both the viewer and the person', () => {
    expect(describePersonContext(person('kiki', 2), GRAPH).mutualConnectionCount).toBe(2);
  });

  it('is zero for a person reached through nobody the viewer touches', () => {
    expect(describePersonContext(person('theo', 3), GRAPH).mutualConnectionCount).toBe(0);
  });

  it('is zero when the payload holds no viewer row at all', () => {
    const viewerless: Graph = { people: [person('kiki', 2)], edges: [] };

    expect(describePersonContext(person('kiki', 2), viewerless).mutualConnectionCount).toBe(0);
  });
});

describe('the counts line', () => {
  // "on your board", not "active": the board read is one page, and the copy claims only
  // what was counted.
  it('pluralises both halves independently', () => {
    expect(connectionsAndBulletinsLine(1, 2)).toBe('1 mutual connection · 2 bulletins on your board');
    expect(connectionsAndBulletinsLine(2, 1)).toBe('2 mutual connections · 1 bulletin on your board');
    expect(connectionsAndBulletinsLine(0, 0)).toBe('0 mutual connections · 0 bulletins on your board');
  });
});
