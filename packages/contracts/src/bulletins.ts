/**
 * The bulletin types a client may **post** in M2.
 *
 * Deliberately smaller than the board grammar's seven types: the grammar accepts a
 * filter for a type nothing has written yet (it must return zero rows rather than
 * become an oracle for what has shipped), while this is the closed set the create
 * procedure's schema enforces.
 */
export const BULLETIN_TYPE = {
  request: 'request',
} as const;

/** One of {@link BULLETIN_TYPE}'s values. */
export type BulletinType = (typeof BULLETIN_TYPE)[keyof typeof BULLETIN_TYPE];

/** `bulletins.create` input. */
export interface CreateBulletinRequest {
  readonly type: BulletinType;
  readonly title: string;
  readonly body: string;
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
  readonly version: number;
  readonly author: BulletinAuthor;
}

/** `bulletins.board` output. */
export interface Board {
  readonly items: readonly VisibleBulletin[];
}
