import type { BoardQuery } from '../../views/views.module';

import type { VisibleBulletin } from './visible-bulletin';

/**
 * How many bulletins one board read returns.
 *
 * ADR-0007's compiled shape ends `LIMIT …`, and this is that limit. An **operational**
 * bound, not a product knob: no client sends it, exactly as no client sends the
 * graph's `node_budget` (ADR-0004 decision 2). Paging is M5, and it arrives as a
 * cursor on {@link import('./visible-bulletin').BoardPage} rather than as a parameter
 * a caller could raise.
 */
export const BOARD_PAGE_SIZE = 50;

/**
 * The port onto `app.visible_bulletins`.
 *
 * Declared in `application/` rather than `domain/` for the reason
 * `modules/graph/application/visible-people.repository.ts` gives: this is a **read
 * model, not a domain entity**. There is no bulletin aggregate to reconstruct here —
 * the aggregate is {@link import('../domain/bulletin').Bulletin}, behind
 * {@link import('../domain/bulletin.repository').BulletinRepository} — and inventing a
 * second domain type to hold a projection would be the placeholder layer addendum §4
 * forbids.
 *
 * ⚠ **Every method composes `app.visible_bulletins` and nothing else.** A method that
 * read `app.bulletins` with its own `where` would be the second visibility predicate
 * ADR-0002 §6 forbids and `sql-table-ownership` cannot see, because a Kysely builder is
 * not a `.sql` file.
 */
export interface VisibleBulletinsRepository {
  /**
   * One bulletin, if this viewer is authorized to see it.
   *
   * @param viewerId - The reading actor's `app.users.id`.
   * @returns `null` for every refusal — unauthorized, archived, and never-existent are
   *   the same answer here, which is what lets the caller raise one
   *   {@link import('../domain/bulletin.errors').BulletinGoneError} for all of them
   *   instead of choosing between three (ADR-0002 §10, B17, M2-AC14).
   */
  findVisibleById(viewerId: string, bulletinId: string): Promise<VisibleBulletin | null>;

  /**
   * The viewer's board, narrowed by an already-validated query.
   *
   * @param query - A {@link BoardQuery}. It is applied **strictly after** the
   *   authorized set (ADR-0007:88-94), so it can only narrow: there is no argument
   *   here through which a filter could reach a row `app.visible_bulletins` did not
   *   produce, which is ADR-0002 B10 stated as a signature.
   * @returns At most {@link BOARD_PAGE_SIZE} bulletins, newest first.
   */
  findVisible(viewerId: string, query: BoardQuery): Promise<readonly VisibleBulletin[]>;
}
