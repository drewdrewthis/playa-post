import type { Graph, Person } from '@playa-post/contracts';

import { ordinal } from '../notes/note-reach';

/**
 * The person sheet's context block (issue #85): the comp's degree label and mutual
 * count, derived from the `graph.list` payload the sheet was opened with.
 *
 * ⚠ Every edge the server sends is between two people the viewer is already allowed to
 * see (`visible-people.sql`), which is what makes intersecting them here safe. That
 * holds only while visibility is symmetric per edge — if the server ever discloses an
 * edge to one endpoint and not the other, this file starts naming vias the server
 * would not have, and the derivation must move behind the wire.
 *
 * ⚠ A via is named only when the payload disclosed a name — never a fallback derived
 * from an id, which is exactly the leak `person-identity.tsx` exists to prevent.
 */

/** What the sheet renders about a person's place on the viewer's graph. */
export interface PersonContext {
  /**
   * The comp's `degLabel`: "1st degree · connected to you", "2nd degree · via
   * {names}", or the bare ordinal from the third degree out — the comp writes a via
   * chain there too, but past the second degree every intermediary is `topology_only`:
   * no name to print, and no placeholder that would not re-identify them.
   */
  readonly degreeLine: string;
  /** How many people stand on an edge with both the viewer and this person. */
  readonly mutualConnectionCount: number;
}

/** Everyone sharing an edge with `userId`, as a set of ids. */
function neighbourIds(userId: string, graph: Graph): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.personAId === userId) {
      ids.add(edge.personBId);
    } else if (edge.personBId === userId) {
      ids.add(edge.personAId);
    }
  }

  return ids;
}

/**
 * The people standing on an edge with both the viewer and this person — the comp's
 * `mutuals`, and at the second degree also its vias. Empty when the payload holds no
 * viewer row (degree 0) to intersect from.
 */
function mutualConnections(person: Person, graph: Graph): readonly Person[] {
  const self = graph.people.find((candidate) => candidate.degree === 0);

  if (self === undefined) {
    return [];
  }

  const viewerNeighbours = neighbourIds(self.userId, graph);
  const personNeighbours = neighbourIds(person.userId, graph);

  return graph.people.filter(
    (candidate) =>
      viewerNeighbours.has(candidate.userId) && personNeighbours.has(candidate.userId),
  );
}

/** The context block's graph-derived half, off one traversal of the edges. */
export function describePersonContext(person: Person, graph: Graph): PersonContext {
  const mutuals = mutualConnections(person, graph);
  const base = `${ordinal(person.degree)} degree`;

  if (person.degree === 1) {
    return { degreeLine: `${base} · connected to you`, mutualConnectionCount: mutuals.length };
  }

  if (person.degree === 2) {
    const viaNames = mutuals
      .map((via) => via.displayName)
      .filter((name): name is string => name !== undefined);

    return {
      degreeLine: viaNames.length === 0 ? base : `${base} · via ${viaNames.join(' + ')}`,
      mutualConnectionCount: mutuals.length,
    };
  }

  return { degreeLine: base, mutualConnectionCount: mutuals.length };
}

/**
 * The counts line, pluralised. The comp writes "{n} active bulletins", but the board
 * read is one page (`BOARD_PAGE_SIZE`), so a total would under-count a busy board —
 * "on your board" claims exactly what was counted: this person's bulletins among the
 * ones the viewer's board is showing.
 */
export function connectionsAndBulletinsLine(mutualCount: number, bulletinCount: number): string {
  const mutuals = `${mutualCount} mutual ${mutualCount === 1 ? 'connection' : 'connections'}`;
  const bulletins = `${bulletinCount} ${bulletinCount === 1 ? 'bulletin' : 'bulletins'} on your board`;

  return `${mutuals} · ${bulletins}`;
}
