import type { ViewerId } from '../../../shared/auth/viewer-id';

import type { VisibleEdgesRepository } from './visible-edges.repository';
import type { VisiblePeopleRepository } from './visible-people.repository';
import type { VisibleGraph, VisiblePerson } from './visible-person';

/**
 * What listing the graph is given.
 *
 * `viewerId` is a {@link ViewerId} — branded, and constructible only from the `Actor`
 * resolved at the tRPC context boundary (ADR-0002 §5a, ADR-0008 rule 8). A `string`
 * parsed out of a request body is not assignable to it, which is the one mitigation
 * R14 has: this design gave up RLS as the enforcement mechanism, so the database will
 * never catch a wrong viewer.
 */
export interface ListVisibleGraphCommand {
  readonly viewerId: ViewerId;
}

export interface ListVisibleGraphQuery {
  list(command: ListVisibleGraphCommand): Promise<VisibleGraph>;
}

/**
 * The same §6a projection, for a person identified by **stored state** rather than by
 * a request.
 *
 * ⚠ **This is the answer `shared/auth/viewer-id.ts` prescribes, not a way around it.**
 * That file forbids a second `ViewerId` constructor and says what to do instead: "if a
 * call site cannot reach an `Actor`, it is running outside the authenticated request
 * scope and has no business performing a viewer-scoped read; give it its own
 * non-viewer-scoped query instead." This is that query. It exists because ADR-0002
 * §11 **requires** a delivery-time authorization re-check inside the notification send
 * handler — a code path that runs on a cron, for a recipient nobody authenticated as,
 * and therefore one no `ViewerId` can ever reach.
 *
 * The brand's purpose survives intact: R14 is a `viewerId` arriving **from request
 * input**, and `userId` here comes from a row this system wrote (`owner_id` on a saved
 * query, `recipient_id` on a computed match). A caller that passes a value it received
 * from a client is the bug, and it is a bug no type can catch — which is why this
 * method is named for its provenance and lives beside the branded one rather than
 * quietly widening it.
 *
 * Consumed by `modules/notifications`; ratified decision (c) makes the §6a projection's
 * signature explicitly changeable by a consuming lane, and this is L3b-notify's change.
 */
export interface VisiblePeopleDirectory {
  /**
   * Everyone this person is currently authorized to see.
   *
   * ⚠ **People, and deliberately not a {@link VisibleGraph}.** The graph read model now
   * also carries edges, which this caller has no use for: it asks "is this bulletin's
   * author still reachable by this recipient" and nothing else. Returning the wrapper
   * would make every delivery-time re-check pay for a second query on a cron path, and
   * would leave a field there for a future edit to start reading — at which point a
   * notification decision would depend on who knows whom.
   *
   * @param userId - An `app.users.id` read from stored state. **Never** a value that
   *   arrived in a request payload.
   */
  listFor(userId: string): Promise<readonly VisiblePerson[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListVisibleGraphDependencies {
  readonly visiblePeople: VisiblePeopleRepository;
  readonly visibleEdges: VisibleEdgesRepository;
}

/**
 * The graph read (M2.7) — ADR-0004 decision 7's `ListVisibleGraphQuery`.
 *
 * **Thin on purpose.** Every visibility rule lives in `app.visible_people` and
 * `app.visible_edges`: who is reachable, what each person's disclosure level is, which
 * identity fields survive it, whose trust is attached, and which pairs may be joined by
 * a line. Re-deriving any of that here would be the second definition of "who can this
 * viewer reach" that ADR-0002 §6 exists to forbid — and the one this lane's own
 * `sql-table-ownership` rule was added to catch.
 *
 * **Two statements, issued concurrently, and neither narrows the other.** The edge
 * function composes `app.visible_people` itself, so it is already constrained to the
 * same authorized set rather than to whatever this function happened to read — which is
 * what makes running them in parallel safe: an edge cannot arrive for a person the
 * people query would have excluded, even under a connection change between the two.
 *
 * `max_depth` and `node_budget` are left at the function's defaults (4 and 1500).
 * They are operational levers rather than product rules (ADR-0004 decision 2), so
 * threading them through configuration is worth doing when an operator needs to turn
 * one — not before.
 */
export function createListVisibleGraphQuery(
  dependencies: ListVisibleGraphDependencies,
): ListVisibleGraphQuery & VisiblePeopleDirectory {
  return {
    async list(command: ListVisibleGraphCommand): Promise<VisibleGraph> {
      const [people, edges] = await Promise.all([
        dependencies.visiblePeople.findVisiblePeople(command.viewerId),
        dependencies.visibleEdges.findVisibleEdges(command.viewerId),
      ]);

      return { people, edges };
    },

    async listFor(userId: string): Promise<readonly VisiblePerson[]> {
      return dependencies.visiblePeople.findVisiblePeopleFor(userId);
    },
  };
}
