import type { ViewerId } from '../../../shared/auth/viewer-id';

import type { VisibleEdge } from './visible-edge';

/**
 * The port onto `app.visible_edges`.
 *
 * **Its own port rather than a third method on
 * {@link import('./visible-people.repository').VisiblePeopleRepository}**, and the split
 * is interface segregation doing real work: the delivery-time authorization re-check
 * (ADR-0002 §11) needs people and has no use for edges, and a port carrying both would
 * make every consumer able to ask for a query it never wants. It also keeps
 * `VisiblePeopleDirectory`'s cron path from silently acquiring a second round trip.
 *
 * Declared in `application/` for the reason its sibling gives: this is a **read model,
 * not a domain entity** (ADR-0004 decision 7). `modules/graph` therefore still has no
 * `domain/` directory, which is a statement about the module rather than an omission.
 */
export interface VisibleEdgesRepository {
  /**
   * Every accepted connection **between two people this viewer can already see**.
   *
   * @param viewerId - A {@link ViewerId}, never a `string`. ADR-0002 §5a: the
   *   catastrophic bug in this architecture is not a missing `WHERE`, it is a viewer
   *   identifier that arrived from request input, and the brand is what makes that
   *   unwritable rather than merely discouraged.
   * @returns Canonically ordered pairs, ascending. Empty for a viewer with no
   *   connections — including the viewer's own edges, which are edges like any other.
   */
  findVisibleEdges(viewerId: ViewerId): Promise<readonly VisibleEdge[]>;
}
