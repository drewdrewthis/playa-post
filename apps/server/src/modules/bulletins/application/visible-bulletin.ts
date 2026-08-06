/**
 * A bulletin's author, projected through `app.visible_people`'s disclosure level.
 *
 * ⚠ The identity fields are **optional, and absent rather than null**, below `full`
 * disclosure. That is ADR-0002 §6a at the type level: a consumer cannot render a name
 * it was not given, and `undefined` is harder to accidentally serialize into a payload
 * than a `null` that looks like a value the UI should hide.
 *
 * The projection happens **in SQL** — `app.visible_bulletins` does not select the
 * columns for an author below `full` — so nothing above the database can forget to
 * strip them ("hidden information must never be sent to the client merely to be
 * concealed by the UI", ADR-0004). A payload that filled a missing name in from
 * anywhere else is the bug B5's person-projection sub-case asserts against.
 *
 * Shaped like `modules/graph`'s exported `VisiblePerson` rather than *being* one:
 * addendum §19 forbids importing another module's domain entity, and this is the
 * author card as this module's read model carries it. The values behind it come from
 * the same function, which is the part that must not be re-derived.
 */
export interface VisibleBulletinAuthor {
  /** `app.users.id`. Safe as output: a caller *supplying* one is the hazard (§5a). */
  readonly userId: string;
  /** `full` or `topology_only`, as `app.visible_people` computed it. */
  readonly disclosure: string;
  /** Present only at `full` disclosure. */
  readonly displayName?: string;
  /** Present only at `full` disclosure. */
  readonly handle?: string;
  /**
   * Present only at `full` disclosure, and never in M2.
   *
   * `app.users.avatar_path` is a private bucket key, not a URL; minting a signed URL
   * has to pass through this same disclosure predicate (ADR-0002 §9/§6a) and the
   * module that mints one is not built in this milestone. The field is declared
   * because a consumer must not go looking for an avatar anywhere else.
   */
  readonly avatarUrl?: string;
}

/**
 * One bulletin a viewer is authorized to see, with its author already projected.
 *
 * Distinct from the {@link import('../domain/bulletin').Bulletin} entity, and the
 * distinction is the §6a rule: the entity is what its author wrote, this is what one
 * specific viewer may be shown. Nothing here is reconstructed from the entity — every
 * field arrives from `app.visible_bulletins` in one read, so there is no seam at which
 * an author card could be assembled from a second query against `app.users`.
 *
 * `archivedAt` is absent because an archived bulletin is absent: the function filters
 * them out for every viewer, so a `VisibleBulletin` is live by construction (M2-AC12).
 */
export interface VisibleBulletin {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  /** ADR-0005's version, so an M5 `bulletin.update` has one to send back. */
  readonly version: number;
  readonly author: VisibleBulletinAuthor;
}

/**
 * A page of the board.
 *
 * A wrapper rather than a bare array because M5 adds a cursor and a `truncated` flag
 * (ADR-0007's `LIMIT`, and the same "state the boundary, never silently" rule ADR-0004
 * decision 2 applies to the graph), and widening an array into an object later is a
 * change at every call site.
 */
export interface BoardPage {
  readonly items: readonly VisibleBulletin[];
}
