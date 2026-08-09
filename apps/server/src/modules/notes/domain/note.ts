/**
 * A note as `app.notes` stores one — the **author's** view of it.
 *
 * This is the entity, not the read model. It carries no author card and no disclosure
 * level, because the only path that reconstructs it is the one where the author *is*
 * the actor: pinning. The recipient's read answers with
 * {@link import('../application/visible-note').VisibleNote} instead, which is projected
 * through `app.visible_notes` and therefore through ADR-0002 §6a.
 *
 * ⚠ **A note is not a bulletin and must never become a bulletin type.** PDF §6 requires
 * fixed-recipient messaging to stay out of the bulletin model, which is why this entity
 * lives in its own module with its own table rather than as a seventh
 * {@link import('../../bulletins/domain/bulletin').BulletinType} (decisions D2 and D6).
 * `bulletins.create` still refuses `note`, and that refusal is asserted by
 * `bulletin-post-types.feature`.
 *
 * There is deliberately no `version` and no `archivedAt`. A note has no update mutation
 * and no take-down in this slice, so both would be columns nothing reads — the
 * placeholder addendum §4 forbids. `version` arrives with the first mutation ADR-0005
 * marks `expectedVersion: yes`, and not before.
 */
export interface Note {
  readonly id: string;
  /** Who wrote it. Taken from the resolved `Actor`, never from request input. */
  readonly authorId: string;
  /**
   * Who it is for — the only person who may ever read it.
   *
   * A first-degree connection of {@link authorId} at the moment it was pinned. The
   * check is part of the insert statement rather than a prior read, so there is no
   * window in which a connection could be removed between the check and the write (see
   * {@link import('./note.repository').NoteRepository.pin}).
   */
  readonly recipientId: string;
  readonly body: string;
  readonly createdAt: Date;
}
