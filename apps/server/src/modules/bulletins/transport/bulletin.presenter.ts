import type {
  BoardPage,
  VisibleBulletin,
  VisibleBulletinAuthor,
} from '../application/visible-bulletin';
import type { Bulletin } from '../domain/bulletin';

/**
 * A bulletin as this API renders one **to its author** — `bulletins.create`,
 * `bulletins.archive`, `bulletins.listMine`.
 *
 * Carries `archivedAt`, which {@link PresentedBoardItem} does not: the author is the
 * only person for whom "archived" is a state rather than an absence (M2-AC12).
 *
 * Timestamps are ISO-8601 strings rather than `Date`s. tRPC without a serializer turns
 * a `Date` into a string on the wire anyway, so declaring the string is declaring what
 * a client actually receives instead of a type that is true only in-process.
 */
export interface PresentedBulletin {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  /** `null` while live. */
  readonly archivedAt: string | null;
  readonly version: number;
}

/**
 * A bulletin's author as this API renders one.
 *
 * The same shape as the {@link VisibleBulletinAuthor} read model, restated here rather
 * than re-exported, because the wire is a contract and the read model is an
 * implementation (the same argument `modules/graph`'s presenter makes).
 *
 * ⚠ Nothing is *added* here, and that is the rule ADR-0002 §6a states: every person
 * representation is projected through `app.visible_people`'s disclosure level, no
 * exceptions. A presenter that filled in a missing name from anywhere else — a cache, a
 * second query, the viewer's own graph — would be exactly the bug B5's
 * person-projection sub-case asserts against.
 */
export interface PresentedBulletinAuthor {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * One bulletin a viewer is authorized to see — `bulletins.board`'s rows and
 * `bulletins.getById`'s answer, which are the same shape because they are the same
 * question asked about a set and about one member of it.
 *
 * No `archivedAt`, unlike {@link PresentedBulletin}: an archived bulletin is not in the
 * authorized set at all, so there is no state here for the field to report.
 */
export interface PresentedVisibleBulletin {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly version: number;
  readonly author: PresentedBulletinAuthor;
}

/** A page of the board, as this API renders it. */
export interface PresentedBoard {
  readonly items: readonly PresentedVisibleBulletin[];
}

/** Project the author's own bulletin onto the wire. */
export function presentBulletin(bulletin: Bulletin): PresentedBulletin {
  return {
    id: bulletin.id,
    type: bulletin.type,
    title: bulletin.title,
    body: bulletin.body,
    createdAt: bulletin.createdAt.toISOString(),
    archivedAt: bulletin.archivedAt === null ? null : bulletin.archivedAt.toISOString(),
    version: bulletin.version,
  };
}

/**
 * Project one already-projected author onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be
 * there, and "the field appeared in the response because someone added it upstream" is
 * how §6a gets violated by accident.
 */
function presentAuthor(author: VisibleBulletinAuthor): PresentedBulletinAuthor {
  return {
    userId: author.userId,
    disclosure: author.disclosure,
    ...(author.displayName === undefined ? {} : { displayName: author.displayName }),
    ...(author.handle === undefined ? {} : { handle: author.handle }),
    ...(author.avatarUrl === undefined ? {} : { avatarUrl: author.avatarUrl }),
  };
}

/** Project one authorized bulletin onto the wire. */
export function presentVisibleBulletin(bulletin: VisibleBulletin): PresentedVisibleBulletin {
  return {
    id: bulletin.id,
    type: bulletin.type,
    title: bulletin.title,
    body: bulletin.body,
    createdAt: bulletin.createdAt.toISOString(),
    version: bulletin.version,
    author: presentAuthor(bulletin.author),
  };
}

/** Project a page of the board. */
export function presentBoard(board: BoardPage): PresentedBoard {
  return { items: board.items.map(presentVisibleBulletin) };
}
