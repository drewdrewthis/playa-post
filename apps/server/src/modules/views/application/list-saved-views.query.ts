import type { SavedViewListing } from '../domain/saved-view';
import type { SavedViewRepository } from '../domain/saved-view.repository';

/**
 * What listing saved views is given.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id` and must arrive from the `Actor`
 * resolved at the tRPC context boundary, never from request input (ADR-0002 §5a, B14).
 * There is no other field, because there is exactly one person's views a caller may read
 * — the same statement `graph.list` and `notifications.list` make.
 */
export interface ListSavedViewsCommand {
  readonly viewerId: string;
}

export interface ListSavedViewsQuery {
  list(command: ListSavedViewsCommand): Promise<SavedViewListing>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListSavedViewsDependencies {
  readonly savedViews: SavedViewRepository;
}

/**
 * The Saved screen's read (issue #45).
 *
 * A pass-through by design: there is no policy between the actor and their own views,
 * and inventing one here would be the placeholder layer addendum §4 forbids. What this
 * file *does* carry is the identifier convention — a `viewerId` that can only have come
 * from a resolved `Actor`.
 *
 * **It reports no match counts.** The card's "N match now" is `bulletins.board({ query })`
 * run per view by the client, which is the only way that number can be guaranteed equal
 * to what the board shows when the same card's "OPEN ON BOARD" is tapped — including its
 * `BOARD_PAGE_SIZE` ceiling. Computing it here would need `modules/views` to consume
 * `modules/bulletins`, which already consumes this module's grammar (ADR-0013): a cycle,
 * and a second definition of what a query matches. See ADR-0016 decision D2.
 */
export function createListSavedViewsQuery(
  dependencies: ListSavedViewsDependencies,
): ListSavedViewsQuery {
  return {
    async list(command: ListSavedViewsCommand): Promise<SavedViewListing> {
      return dependencies.savedViews.listFor(command.viewerId);
    },
  };
}
