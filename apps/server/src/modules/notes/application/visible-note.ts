/**
 * A note's author, projected through `app.visible_people`'s disclosure level.
 *
 * ⚠ The identity fields are **optional, and absent rather than null**, below `full`
 * disclosure. That is ADR-0002 §6a at the type level: a consumer cannot render a name it
 * was not given, and `undefined` is harder to accidentally serialize into a payload than
 * a `null` that looks like a value the UI should hide.
 *
 * The projection happens **in SQL** — `app.visible_notes` does not select the columns
 * for an author below `full` — so nothing above the database can forget to strip them
 * ("hidden information must never be sent to the client merely to be concealed by the
 * UI", ADR-0004).
 *
 * ⚠ **Pinning required degree 1; reading does not re-derive it.** An author who was a
 * direct connection when the note was pinned may since have moved further away, or may
 * disclose only `limited` — so a note can legitimately arrive with no name on it, and (see
 * {@link VisibleNote.author}) with no author card at all. A consumer that filled either
 * in from anywhere else — the recipient's own graph, a cache, the connection they
 * remember — is the bug B5's person-projection sub-case asserts against.
 *
 * Shaped like `modules/graph`'s exported `VisiblePerson` rather than *being* one:
 * addendum §19 forbids importing another module's domain entity, and this is the author
 * card as this module's read model carries it.
 */
export interface VisibleNoteAuthor {
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

/**
 * One note a viewer is authorized to read, with its author already projected.
 *
 * Distinct from the {@link import('../domain/note').Note} entity, and the distinction is
 * the §6a rule: the entity is what its author wrote, this is what its one recipient may
 * be shown. Nothing here is reconstructed from the entity — every field arrives from
 * `app.visible_notes` in one read, so there is no seam at which an author card could be
 * assembled from a second query against `app.users`.
 *
 * There is no `recipientId`, deliberately: the only viewer who can hold one of these is
 * the recipient, so the field could only ever echo back who is asking.
 */
export interface VisibleNote {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
  /**
   * ⚠ **Optional, because the note survives its author leaving.** A note was addressed
   * and delivered; it belongs to the person it was left with. Severing the connection,
   * the author deactivating, and the graph traversal reaching its own bounds each remove
   * the *card* — `app.visible_notes` LEFT-joins `app.visible_people` and projects every
   * author column from that set — and none of them removes the *message*.
   *
   * Absent rather than `null`, and whole or nothing rather than partially filled: this is
   * a different absence from {@link VisibleNoteAuthor}'s missing name. There, a person is
   * present and under-disclosed; here there is no person to disclose, so not even
   * `userId` is projected — handing back the raw `app.notes.author_id` of someone the
   * graph has already decided this viewer may not see is precisely what the LEFT JOIN
   * must not be allowed to do.
   */
  readonly author?: VisibleNoteAuthor;
}
