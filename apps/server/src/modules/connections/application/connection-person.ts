/**
 * One person on a connections surface, projected through `app.visible_people`'s
 * disclosure level.
 *
 * ⚠ The identity fields are **optional, and absent rather than null**, below `full`
 * disclosure. That is ADR-0002 §6a at the type level: a consumer cannot render a name it
 * was not given, and `undefined` is harder to accidentally serialize into a payload than a
 * `null` that looks like a value the UI should hide.
 *
 * The projection happens **in SQL** — every read composes `app.visible_people` and the
 * function does not select the identity columns below `full` — so nothing above the
 * database can forget to strip them.
 *
 * ⚠ **Which viewer the projection was computed for is the consent rule made structural,
 * and on this module's two new surfaces it is never the reader** (issue #206). A personal
 * link's owner is projected from *their own* self-projection, `app.visible_people(owner,
 * 0, 1)`, because publishing the link is the consent to be named to whoever holds it; a
 * requester on the owner's inbox is projected the same way, because asking is the consent.
 * Both are the inversion ADR-0017 D4 established, and both stay inside §6a — a deactivated
 * person is absent from the function and therefore absent from the surface, for free
 * (ADR-0002 B11).
 *
 * Shaped like `modules/graph`'s exported `VisiblePerson` rather than *being* one: addendum
 * §19 forbids importing another module's domain entity, and this is the person card as this
 * module's read models carry it.
 */
export interface ConnectionPerson {
  /** `app.users.id`. Safe as output: a caller *supplying* one is the hazard (§5a). */
  readonly userId: string;
  /** `full` or `topology_only`, as `app.visible_people` computed it. */
  readonly disclosure: string;
  /** Present only at `full` disclosure. */
  readonly displayName?: string;
  /** Present only at `full` disclosure. */
  readonly handle?: string;
  /**
   * Present only at `full` disclosure, and never yet.
   *
   * `app.users.avatar_path` is a private bucket key, not a URL; minting a signed URL has to
   * pass through this same disclosure predicate (ADR-0002 §9/§6a) and the module that mints
   * one does not exist. The field is declared because a consumer must not go looking for an
   * avatar anywhere else.
   */
  readonly avatarUrl?: string;
}
