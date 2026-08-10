import type { Graph, Person } from '@playa-post/contracts';

/**
 * The person sheet's context block (issue #85): the comp's degree label and its
 * "{n} mutual connections · {n} active bulletins" line, computed from payloads the
 * screen already holds.
 *
 * ⚠ **Everything here is derived client-side from `graph.list`, and that is by design,
 * not a shortcut.** The server deliberately sends no `path_via` or `mutual_count`
 * (`visible-people.sql`, M5 B1/B2) — but every edge it *does* send is between two people
 * the viewer is already allowed to see, so intersecting them reveals nothing the screen
 * has not drawn. The graph contract's "do not infer" warning is about trust weight, which
 * nothing below touches.
 *
 * ⚠ **A via is named only when the payload disclosed a name.** At the second degree every
 * via is a direct connection and arrives `full`, so in practice they are named — but the
 * code still reads the field, never assumes the rule, because a fallback derived from an
 * id is exactly the leak `person-identity.tsx` exists to prevent.
 */

/** "1st", "2nd", "3rd", "4th"… — with the teens ("11th"–"13th") spelt right. */
function ordinal(n: number): string {
  const teens = n % 100;

  if (teens >= 11 && teens <= 13) {
    return `${n}th`;
  }

  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
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

/** The viewer's own row — degree 0, present in every `graph.list` payload. */
function viewer(graph: Graph): Person | undefined {
  return graph.people.find((person) => person.degree === 0);
}

/**
 * The people standing on an edge with both the viewer and this person — the comp's
 * `mutuals`, and at the second degree also its vias.
 */
function mutualConnections(person: Person, graph: Graph): readonly Person[] {
  const self = viewer(graph);

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

/**
 * The comp's `degLabel`: "1st degree · connected to you", "2nd degree · via {names}",
 * or the bare ordinal from the third degree out.
 *
 * The comp writes a via chain at the third degree too ("Moss → Kiki"), but past the
 * second degree every intermediary is `topology_only` — there is no name to print and
 * no placeholder that would not re-identify them, so the ordinal stands alone.
 */
export function degreeLine(person: Person, graph: Graph): string {
  const base = `${ordinal(person.degree)} degree`;

  if (person.degree === 1) {
    return `${base} · connected to you`;
  }

  if (person.degree === 2) {
    const viaNames = mutualConnections(person, graph)
      .map((via) => via.displayName)
      .filter((name): name is string => name !== undefined);

    return viaNames.length === 0 ? base : `${base} · via ${viaNames.join(' + ')}`;
  }

  return base;
}

/** How many people connect to both the viewer and this person. */
export function mutualConnectionCount(person: Person, graph: Graph): number {
  return mutualConnections(person, graph).length;
}

/**
 * The comp's "{n} mutual connections · {n} active bulletins" line, pluralised.
 *
 * @param bulletinCount - this person's bulletins **on the viewer's own board read** —
 *   the honest number, since the server never reports bulletins the viewer cannot see.
 */
export function connectionsAndBulletinsLine(mutualCount: number, bulletinCount: number): string {
  const mutuals = `${mutualCount} mutual ${mutualCount === 1 ? 'connection' : 'connections'}`;
  const bulletins = `${bulletinCount} active ${bulletinCount === 1 ? 'bulletin' : 'bulletins'}`;

  return `${mutuals} · ${bulletins}`;
}
