/**
 * One accepted connection between two people this viewer can already see.
 *
 * **Undirected, and canonically ordered.** `personAId` is always the lexicographically
 * smaller identifier, so one connection is one edge whichever way round it happens to be
 * stored and a client can key a rendered line by the pair without normalising first.
 * Neither endpoint is "the source": a connection has no inviter side once it is
 * accepted (`app.connections`' own note).
 *
 * ⚠ **Carries no weight, no trust, and no disclosure level, and must never grow one.**
 * ADR-0004 decision 6: edges incident to the viewer carry the viewer's own trust, and
 * edges between two other people carry no weight at all. The viewer's trust already
 * rides {@link import('./visible-person').VisiblePerson.trust}, per person; putting it
 * here would duplicate it for the viewer's own edges and — for an edge between two other
 * people — invent a value that is nobody's to see (ADR-0002 B6).
 *
 * ⚠ **An edge never introduces a person.** `app.visible_edges` emits a pair only when
 * both endpoints are already in `app.visible_people(viewer_id)`, so every identifier
 * here also appears in {@link import('./visible-person').VisibleGraph.people}. A client
 * that finds one that does not has hit a bug, not a person to render.
 */
export interface VisibleEdge {
  /** The lexicographically smaller of the two `app.users.id`s. */
  readonly personAId: string;
  /** The lexicographically larger of the two `app.users.id`s. */
  readonly personBId: string;
}
