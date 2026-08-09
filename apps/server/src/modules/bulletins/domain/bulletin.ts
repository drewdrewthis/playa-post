/**
 * The bulletin types a person can **post** — the comp's compose vocabulary, in the
 * comp's chip order (#87, `bulletin-post-types.feature`).
 *
 * ⚠ Deliberately **not** the same list as
 * {@link import('../../views/domain/board-query-grammar').BOARD_BULLETIN_TYPES}, which
 * is the `type:` filter's vocabulary and carries seven: `update` is filterable but
 * never postable, because a network update is something the system writes, not
 * something a person composes. Merging the two lists is how the write surface widens
 * by accident — `bulletin-post-types.feature`'s refusal scenario fails on exactly that.
 */
export const BULLETIN_TYPE = {
  offer: 'offer',
  request: 'request',
  event: 'event',
  collab: 'collab',
  thanks: 'thanks',
  intro: 'intro',
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
  /**
   * Free-text place, as the author typed it. `null` when the bulletin names none.
   *
   * A display string and never a lookup key: nothing geocodes it, indexes it, or
   * matches on it. `app.visible_bulletins`' free-text haystack is title and body only,
   * so a location cannot become a channel for finding *people* by where they camp.
   */
  readonly loc: string | null;
  /**
   * When this bulletin stops being visible. `null` means it never does.
   *
   * ⚠ Enforced in `app.visible_bulletins`, beside `archived_at`, and therefore for
   * every viewer-scoped read at once. This field is carried on the entity because the
   * **author** must be able to see what they set — `bulletins.listMine` reads the table
   * directly and is the one place an already-expired bulletin still surfaces, exactly
   * as an archived one does (M2-AC12's retention half).
   */
  readonly expiresAt: Date | null;
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
