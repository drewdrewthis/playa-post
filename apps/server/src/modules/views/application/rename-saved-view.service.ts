import type { SavedView } from '../domain/saved-view';
import { validateSavedViewName } from '../domain/saved-view-name.policy';
import type { SavedViewRepository } from '../domain/saved-view.repository';

/** What renaming a view is given. `actorId` is the resolved `Actor`'s, never input. */
export interface RenameSavedViewCommand {
  readonly actorId: string;
  readonly viewId: string;
  readonly name: string;
  /** ADR-0005:102. The version the caller read from `views.saved.list`. */
  readonly expectedVersion: number;
}

export interface RenameSavedViewService {
  rename(command: RenameSavedViewCommand): Promise<SavedView>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface RenameSavedViewDependencies {
  readonly savedViews: SavedViewRepository;
  /** Reads the wall clock. Overridable so a test can pin `updated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The rename-a-view use case (issue #45) — the second half of ADR-0005's `view.save`.
 *
 * **Only the name changes.** A view's query is what the person searched for when they
 * saved it; re-pointing an existing card at different results under the same name is the
 * one edit that would make a saved view untrustworthy, and the board's own "Save as view"
 * already makes a new one cheap. There is deliberately no `sourceText` on the command.
 *
 * There is no read-then-compare-then-write: the version predicate lives in the `WHERE`
 * clause of one conditional statement alongside `owner_id`, so actorship cannot be
 * reordered after version comparison by a later edit (ADR-0005 precedence rule 1) and a
 * concurrent rename cannot win a race against a check that already passed.
 *
 * @throws {import('../domain/saved-view.errors').SavedViewNameInvalidError}
 * @throws {import('../domain/saved-view.errors').SavedViewConflictError} when the row,
 *   the owner, or the version did not match — carrying none of the stored state.
 */
export function createRenameSavedViewService(
  dependencies: RenameSavedViewDependencies,
): RenameSavedViewService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async rename(command: RenameSavedViewCommand): Promise<SavedView> {
      const name = validateSavedViewName(command.name);

      return dependencies.savedViews.rename({
        ownerId: command.actorId,
        viewId: command.viewId,
        name,
        expectedVersion: command.expectedVersion,
        renamedAt: readClock(),
      });
    },
  };
}
