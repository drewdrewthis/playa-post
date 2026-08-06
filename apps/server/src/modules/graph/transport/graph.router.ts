import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { ListVisibleGraphQuery } from '../application/list-visible-graph.query';

import { presentGraph, type PresentedGraph } from './visible-person.presenter';

/** The application operations this router speaks for. One use case, one procedure. */
export interface GraphRouterDependencies {
  readonly listVisibleGraph: ListVisibleGraphQuery;
}

/**
 * The graph module's tRPC surface.
 *
 * **One procedure, and it takes no input at all.** That is the whole of ADR-0002 §5a
 * expressed as an API: there is exactly one graph a caller may read — their own — so
 * there is no parameter that could name a different one. `ctx.viewerId` is minted by
 * the `authenticatedProcedure` middleware from the resolved `Actor` and is the only
 * `ViewerId` in the system.
 *
 * No pagination and no depth parameter either. `max_depth` and `node_budget` are
 * operational bounds an operator turns, never product knobs a client sends
 * (ADR-0004 decision 2) — a client-supplied depth would be a client deciding how much
 * of the network to traverse, which is a visibility decision.
 */
export function createGraphRouter(dependencies: GraphRouterDependencies) {
  return router({
    list: authenticatedProcedure.query(
      async ({ ctx }): Promise<PresentedGraph> =>
        presentGraph(await dependencies.listVisibleGraph.list({ viewerId: ctx.viewerId })),
    ),
  });
}

/** The graph router's type, for the root router to mount it by. */
export type GraphRouter = ReturnType<typeof createGraphRouter>;
