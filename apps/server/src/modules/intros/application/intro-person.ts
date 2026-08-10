/**
 * One person on an intro surface, projected through `app.visible_people`'s disclosure
 * level.
 *
 * ⚠ The identity fields are **optional, and absent rather than null**, below `full`
 * disclosure. That is ADR-0002 §6a at the type level: a consumer cannot render a name it
 * was not given, and `undefined` is harder to accidentally serialize into a payload than
 * a `null` that looks like a value the UI should hide.
 *
 * The projection happens **in SQL** — every read composes `app.visible_people` and the
 * function does not select the identity columns below `full` — so nothing above the
 * database can forget to strip them ("hidden information must never be sent to the
 * client merely to be concealed by the UI", ADR-0004).
 *
 * ⚠ **Which viewer the projection was computed for differs by role, and that is the
 * consent rule made structural.** A via sees the requester and the target as their own
 * settings disclose them to the via. A target sees the requester as the *requester's own
 * self-projection* — because asking for the intro is the consent, and a requester whose
 * `visible_to_distance` would otherwise hide them from the target chose to be seen here.
 * Neither is assembled by joining `app.users`; both come out of the canonical function.
 *
 * Shaped like `modules/graph`'s exported `VisiblePerson` rather than *being* one:
 * addendum §19 forbids importing another module's domain entity, and this is the person
 * card as this module's read models carry it.
 */
export interface IntroPerson {
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
   * `app.users.avatar_path` is a private bucket key, not a URL; minting a signed URL has
   * to pass through this same disclosure predicate (ADR-0002 §9/§6a) and the module that
   * mints one does not exist. The field is declared because a consumer must not go
   * looking for an avatar anywhere else.
   */
  readonly avatarUrl?: string;
}
