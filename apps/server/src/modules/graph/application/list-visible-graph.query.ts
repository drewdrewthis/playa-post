import type { ViewerId } from '../../../shared/auth/viewer-id';

import type { VisiblePeopleRepository } from './visible-people.repository';
import type { VisibleGraph } from './visible-person';

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

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListVisibleGraphDependencies {
  readonly visiblePeople: VisiblePeopleRepository;
}

/**
 * The graph read (M2.7) — ADR-0004 decision 7's `ListVisibleGraphQuery`.
 *
 * **Thin on purpose.** Every visibility rule lives in `app.visible_people`: who is
 * reachable, what each person's disclosure level is, which identity fields survive it,
 * and whose trust is attached. Re-deriving any of that here would be the second
 * definition of "who can this viewer reach" that ADR-0002 §6 exists to forbid — and
 * the one this lane's own `sql-table-ownership` rule was added to catch.
 *
 * `max_depth` and `node_budget` are left at the function's defaults (4 and 1500).
 * They are operational levers rather than product rules (ADR-0004 decision 2), so
 * threading them through configuration is worth doing when an operator needs to turn
 * one — not before.
 */
export function createListVisibleGraphQuery(
  dependencies: ListVisibleGraphDependencies,
): ListVisibleGraphQuery {
  return {
    async list(command: ListVisibleGraphCommand): Promise<VisibleGraph> {
      return { people: await dependencies.visiblePeople.findVisiblePeople(command.viewerId) };
    },
  };
}
