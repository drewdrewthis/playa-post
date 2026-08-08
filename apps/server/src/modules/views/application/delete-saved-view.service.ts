import type { SavedViewRepository } from '../domain/saved-view.repository';

/** What deleting a view is given. `actorId` is the resolved `Actor`'s, never input. */
export interface DeleteSavedViewCommand {
  readonly actorId: string;
  readonly viewId: string;
}

/** What the caller is told. See {@link DeleteSavedViewService.delete}. */
export interface SavedViewDeletion {
  readonly viewId: string;
  /** `false` when the view was already gone — the request still succeeded. */
  readonly deleted: boolean;
}

export interface DeleteSavedViewService {
  delete(command: DeleteSavedViewCommand): Promise<SavedViewDeletion>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DeleteSavedViewDependencies {
  readonly savedViews: SavedViewRepository;
  /** Reads the wall clock. Overridable so a test can pin the cleared event. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The delete-a-view use case (issue #45).
 *
 * ⚠ **Idempotent, and it does not distinguish "already deleted" from "never yours".**
 * Both answer `deleted: false` with a 200 rather than a 404, because a delete asks for a
 * *state* and that state holds either way — and because the alternative is a membership
 * oracle: a 404 for one and a 200 for the other tells an actor which view IDs are real.
 * M5-AC16 wants user B unable to learn anything about user A's views by ID, and silence
 * is the only answer that gives nothing away. The repository's `WHERE owner_id = <actor>`
 * is what makes the two cases identical at the database.
 *
 * Deleting a view that is the Notify Me source also stops the notifications, in the same
 * transaction — see {@link SavedViewRepository.delete}.
 */
export function createDeleteSavedViewService(
  dependencies: DeleteSavedViewDependencies,
): DeleteSavedViewService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async delete(command: DeleteSavedViewCommand): Promise<SavedViewDeletion> {
      const deleted = await dependencies.savedViews.delete({
        ownerId: command.actorId,
        viewId: command.viewId,
        deletedAt: readClock(),
      });

      return { viewId: command.viewId, deleted };
    },
  };
}
