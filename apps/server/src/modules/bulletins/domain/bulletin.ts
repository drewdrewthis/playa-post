/**
 * The bulletin types this milestone can write.
 *
 * One value. The other six PDF types are M5 (`bulletin-request-lifecycle.feature`'s
 * own scope comment), and they arrive as values here.
 *
 * ⚠ Deliberately **not** the same list as
 * {@link import('../../views/domain/board-query-grammar').BOARD_BULLETIN_TYPES}, which
 * is the `type:` filter's vocabulary and carries all seven. Filtering for a type
 * nothing has been written as yet must return zero rows; refusing it would make the
 * grammar an oracle for what the product has shipped, and merging the two lists is how
 * that happens by accident.
 */
export const BULLETIN_TYPE = {
  request: 'request',
} as const;

/** One of {@link BULLETIN_TYPE}'s values. */
export type BulletinType = (typeof BULLETIN_TYPE)[keyof typeof BULLETIN_TYPE];

/**
 * A bulletin as `app.bulletins` stores one — the **author's** view of it.
 *
 * This is the entity, not the read model. It carries no author card and no disclosure
 * level, because the only paths that reconstruct it are the ones where the author *is*
 * the actor: create, archive, and `bulletins.listMine`. Every viewer-scoped read
 * answers with
 * {@link import('../application/visible-bulletin').VisibleBulletin} instead, which is
 * projected through `app.visible_bulletins` and therefore through ADR-0002 §6a.
 *
 * `type` is typed `string` for the reason `modules/connections/domain/connection.ts`
 * gives for `Connection.status`: the column carries no check constraint, so an
 * unrecognised value is reachable and every consumer must fail closed on one.
 */
export interface Bulletin {
  readonly id: string;
  readonly authorId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  /** `null` while live. Absence, not a sentinel, is the unarchived state. */
  readonly archivedAt: Date | null;
  /**
   * ADR-0005's optimistic-concurrency version.
   *
   * Read by nothing in M2 — `bulletin.create` and `bulletin.archive` are both
   * `expectedVersion: no` in ADR-0005's matrix. It is carried because `bulletin.update`
   * (M5) is `expectedVersion: yes`, and a client cannot send back a version it was
   * never given.
   */
  readonly version: number;
}
