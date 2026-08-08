import { BOARD_QUERY_AST_VERSION, parseBoardQuery } from '../domain/board-query-grammar';
import type { SavedView } from '../domain/saved-view';
import { validateSavedViewName } from '../domain/saved-view-name.policy';
import type { SavedViewRepository } from '../domain/saved-view.repository';

/**
 * What saving a view is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary, never from the
 * request body (ADR-0002:180-181), and there is no field naming an owner — the actor
 * *is* the owner, so no unrelated-actor case exists for this operation to fail closed on.
 */
export interface SaveViewCommand {
  readonly actorId: string;
  /** What to call it. Trimmed and bounded by `validateSavedViewName`. */
  readonly name: string;
  /** Raw query text as the person typed it; validated here, stored beside its AST. */
  readonly sourceText: string;
}

export interface SaveViewService {
  save(command: SaveViewCommand): Promise<SavedView>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SaveViewDependencies {
  readonly savedViews: SavedViewRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The save-a-view use case (issue #45) — ADR-0005's `view.save`.
 *
 * Three steps and no fourth: validate the name, validate the text through **the**
 * grammar, then hand one atomic write to the repository.
 *
 * **Both the source text and the validated AST are stored** (ADR-0007:73-79). Storing
 * only the text would make every later evaluation re-parse untrusted input; storing only
 * the AST would lose what the person typed and make re-opening the view on the board a
 * lossy re-serialization of their own words.
 *
 * ⚠ **The grammar is not widened here.** `from:`, `deg:`, `trust:`, `is:`, negation and
 * quoted phrases are refused *naming the token* exactly as they are on the board
 * (ADR-0007:53-56). A query the board would not run must not become a view that claims to
 * run it — the person saving it is present to see the error, and nobody is present later.
 *
 * @throws {import('../domain/saved-view.errors').SavedViewNameInvalidError}
 * @throws {import('../domain/board-query-grammar').InvalidBoardQueryError} naming the
 *   offending token.
 * @throws {import('../domain/saved-view.errors').SavedViewLimitReachedError}
 */
export function createSaveViewService(dependencies: SaveViewDependencies): SaveViewService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async save(command: SaveViewCommand): Promise<SavedView> {
      const name = validateSavedViewName(command.name);
      const query = parseBoardQuery(command.sourceText);

      return dependencies.savedViews.save({
        ownerId: command.actorId,
        name,
        sourceText: command.sourceText,
        query,
        astVersion: BOARD_QUERY_AST_VERSION,
        createdAt: readClock(),
      });
    },
  };
}
