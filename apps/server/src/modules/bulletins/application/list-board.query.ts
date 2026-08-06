import { EMPTY_BOARD_QUERY, parseBoardQuery } from '../../views/views.module';

import type { BoardPage } from './visible-bulletin';
import type { VisibleBulletinsRepository } from './visible-bulletins.repository';

/**
 * What listing the board is given.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the
 * `Actor` resolved at the tRPC context boundary — never from request input
 * (ADR-0002 §5a, B14). The transport passes `ctx.viewerId`, the branded
 * {@link import('../../../shared/auth/viewer-id').ViewerId} whose only constructor
 * takes an `Actor`; this command widens it to `string` the same way every
 * `modules/connections` command widens `actorId`, so that the application layer states
 * one identifier convention rather than two.
 *
 * The mechanical guarantee lives where a mistake would actually be made: no procedure
 * input may carry a `viewerId`/`userId`/`actorId`/`ownerId` field, and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the real router to prove
 * it. A `string` here cannot be reached from a request body without adding such a
 * field first.
 */
export interface ListBoardCommand {
  readonly viewerId: string;
  /**
   * ADR-0007 query text, exactly as the person typed it. Absent means the default
   * board.
   *
   * Parsed here rather than at the transport so the `sync`/saved-view paths (M5) reach
   * the same validator instead of restating the grammar, and so a rejection surfaces as
   * `INVALID_BOARD_QUERY` rather than a generic transport `BAD_REQUEST` (M2-AC13/AC18).
   */
  readonly query?: string | undefined;
}

export interface ListBoardQuery {
  list(command: ListBoardCommand): Promise<BoardPage>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListBoardDependencies {
  readonly bulletins: VisibleBulletinsRepository;
}

/**
 * The board read (M2.9) — ADR-0007's board-list consumer of the shared grammar.
 *
 * **Two steps, in this order, and the order is the security property**: parse the
 * text into a validated AST, then ask the repository for the authorized set narrowed by
 * it. The filter is never resolved *against* anything before authorization — ADR-0007's
 * shape is `WITH authorized AS (…) SELECT … WHERE <compiled filter>`, so a term is a
 * predicate over rows the viewer could already see, never a lookup that might find one
 * they could not. That is ADR-0002 B10, and it is structural: {@link ListBoardCommand}
 * has nowhere to carry an author, an ID, or a raw fragment.
 *
 * An unparseable query raises
 * {@link import('../../views/views.module').InvalidBoardQueryError} and returns no
 * rows at all — never a partially-applied filter, which would show results nobody
 * asked for (ADR-0007:53-56).
 */
export function createListBoardQuery(dependencies: ListBoardDependencies): ListBoardQuery {
  return {
    async list(command: ListBoardCommand): Promise<BoardPage> {
      const query = command.query === undefined ? EMPTY_BOARD_QUERY : parseBoardQuery(command.query);

      return { items: await dependencies.bulletins.findVisible(command.viewerId, query) };
    },
  };
}
