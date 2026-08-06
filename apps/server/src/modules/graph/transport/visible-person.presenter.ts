import type { VisibleGraph, VisiblePerson } from '../application/visible-person';

/**
 * A person as this API renders one.
 *
 * The same shape as the {@link VisiblePerson} read model, restated here rather than
 * re-exported, because the wire is a contract and the read model is an implementation
 * that lane-brief C8 explicitly expects the first consuming lane to change. Re-exporting
 * would make a signature change for L3a's convenience a silent break in the client's
 * API.
 *
 * ⚠ Nothing is *added* here, and that is the rule §6a states: every person
 * representation is projected through `app.visible_people`'s disclosure level, no
 * exceptions. A presenter that filled in a missing name from anywhere else — a cache,
 * a second query, the actor's own record — would be exactly the bug B5's
 * person-projection sub-case asserts against.
 */
export interface PresentedPerson {
  readonly userId: string;
  readonly degree: number;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  /**
   * The viewer's own trust toward this person, `null` when unset.
   *
   * Safe on this payload and on no other: the graph is read by the viewer, as the
   * viewer, and the value is theirs (ADR-0004 decision 6). ADR-0002 B6 is about
   * payloads reachable by the *other* party or a third party — which this one, by
   * construction, is not.
   */
  readonly trust: number | null;
}

/** The viewer's graph, as this API renders it. */
export interface PresentedGraph {
  readonly people: readonly PresentedPerson[];
}

/**
 * Project one already-projected person onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be
 * there, and "the field appeared in the response because someone added it upstream" is
 * how §6a gets violated by accident.
 */
function presentPerson(person: VisiblePerson): PresentedPerson {
  return {
    userId: person.userId,
    degree: person.degree,
    disclosure: person.disclosure,
    ...(person.displayName === undefined ? {} : { displayName: person.displayName }),
    ...(person.handle === undefined ? {} : { handle: person.handle }),
    ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
    trust: person.trust,
  };
}

/** Project the viewer's graph. */
export function presentGraph(graph: VisibleGraph): PresentedGraph {
  return { people: graph.people.map(presentPerson) };
}
