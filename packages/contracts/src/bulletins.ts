/**
 * The bulletin types a client may **post** — the comp's compose vocabulary, in the
 * comp's chip order (#87).
 *
 * Deliberately smaller than the board grammar's seven types: `update` is filterable
 * but never postable — a network update is something the system writes, not something
 * a person composes. The grammar list stays separate so a filter for a type nothing
 * has written yet returns zero rows rather than becoming an oracle for what shipped.
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
 * `bulletins.create` input.
 *
 * `loc` and `expiresAt` are `?: T | undefined` rather than `?: T`, for the reason
 * {@link BoardRequest} gives: the server marks them `.optional()`, which accepts an
 * explicitly-`undefined` value as well as an omitted key.
 *
 * There is deliberately **no audience field**. Who can see a bulletin is decided by the
 * viewer's reachability, in `app.visible_bulletins`, and a per-bulletin audience would
 * be a second answer to that question — a trust-model change rather than a form field.
 */
export interface CreateBulletinRequest {
  readonly type: BulletinType;
  readonly title: string;
  readonly body: string;
  /**
   * Free-text place — "7:30 & E", "departing Reno, Aug 24". At most 120 characters
   * after trimming; a value that trims to nothing is stored as no location at all.
   *
   * ⚠ A display string, never searched and never matched on. Do not build a filter,
   * a map pin, or a "who is near me" affordance from it.
   */
  readonly loc?: string | undefined;
  /**
   * ISO-8601 moment the bulletin stops being visible. Omit for one that never does.
   *
   * Must not already have passed, or the call is refused with
   * `BULLETIN_EXPIRY_INVALID`. An offset (`-07:00`) is accepted as well as `Z`.
   */
  readonly expiresAt?: string | undefined;
}

/** Input of every procedure that names one bulletin. */
export interface BulletinIdRequest {
  readonly bulletinId: string;
}

/**
 * `bulletins.board` input. `query` absent means the unfiltered board.
 *
 * `?: string | undefined` rather than `?: string`, with
 * `exactOptionalPropertyTypes` on: the server's schema marks it `.optional()`, which
 * accepts an explicitly-`undefined` value as well as an omitted key. Declaring the
 * narrower form would refuse a call the server would have served.
 */
export interface BoardRequest {
  readonly query?: string | undefined;
}

/**
 * A bulletin as its **author** sees it: the entity, with lifecycle state.
 *
 * `archivedAt` is `null` while live. It is the only place archived-ness is observable,
 * which is why the author's own board rows come from `bulletins.listMine` rather than
 * from {@link VisibleBulletin}.
 */
export interface Bulletin {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  /** Free-text place. `null` when the bulletin names none. */
  readonly loc: string | null;
  /**
   * ISO-8601, or `null` when the bulletin never expires.
   *
   * ⚠ **May already have passed**, unlike {@link VisibleBulletin.expiresAt}: this is the
   * author's own view, and an expired bulletin stays on their list exactly as an
   * archived one does. A client rendering `bulletins.listMine` decides for itself how to
   * mark one; the server does not remove it.
   */
  readonly expiresAt: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
}

/**
 * The author card on a bulletin, under the same §6a disclosure rule the graph uses.
 *
 * Absent name/handle/avatar means render none of them — see {@link import('./graph').Person}.
 */
export interface BulletinAuthor {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * A bulletin as an **eligible viewer** sees it.
 *
 * ⚠ Carries no `archivedAt`, not even optionally: an archived bulletin is not visible,
 * so the field would only ever be one value and its presence would invite a client to
 * ask a question the read model has already answered.
 */
export interface VisibleBulletin {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  /**
   * Free-text place. `null` when the bulletin names none.
   *
   * `null` rather than an omitted key, deliberately unlike {@link BulletinAuthor}'s
   * identity fields: those are absent because the disclosure rule withheld them, this
   * is present and empty. Render no location line for `null`; never substitute one.
   */
  readonly loc: string | null;
  /**
   * ISO-8601, or `null` when the bulletin never expires.
   *
   * ⚠ **Always in the future**: an expired bulletin is not visible, so it never reaches
   * a board or a `getById`. Safe to render as a countdown; not a value to filter on
   * client-side, because the server has already done it.
   */
  readonly expiresAt: string | null;
  readonly version: number;
  readonly author: BulletinAuthor;
}

/** `bulletins.board` output. */
export interface Board {
  readonly items: readonly VisibleBulletin[];
}
