/**
 * `notes.pin` input.
 *
 * A note is pinned to **one** person's board and read by nobody else. There is
 * deliberately no audience field and no type field: a note is not a bulletin, and the
 * separation is the product decision (PDF §6, decisions D2 and D6) rather than a missing
 * feature. `bulletins.create` refuses the value `note` for the same reason.
 *
 * `recipientId` must be a first-degree connection of the caller. Anyone else — two hops
 * away, a stranger, a deactivated account, a UUID naming nobody, or the caller
 * themselves — is refused identically with `NOTE_RECIPIENT_UNREACHABLE`. Do not build a
 * "can I write to this person" probe out of it: the answer is deliberately the same for
 * "no" and "there is no such person".
 */
export interface PinNoteRequest {
  readonly recipientId: string;
  /**
   * The note. At most 4000 characters after trimming, and never empty — a whitespace-only
   * note is refused with `NOTE_CONTENT_INVALID`.
   *
   * ⚠ Never searched, never indexed, and never carried in an event payload. There is no
   * query grammar over notes, so nothing a person writes here can turn into a way to find
   * them.
   */
  readonly body: string;
}

/**
 * A note as its **author** sees it — `notes.pin`'s answer.
 *
 * Carries `recipientId`, which {@link Note} does not, and no author card, which {@link Note}
 * does: the author is the caller, so there is no person here to project.
 *
 * ⚠ **It carries no `body` either, and that is a privacy rule rather than a saving.** The
 * author wrote the note; handing it straight back tells them nothing they did not just
 * type. What it *would* do is put the text somewhere else: the same value answers the
 * offline path, where `sync.submitMutations` stores every result verbatim in
 * `app.mutation_results.result` for the 30-day replay window (ADR-0005), in a row no
 * recipient gating touches. That is the second copy of a note's text D6 and PDF §6 keep
 * this product from making — one copy, in `app.notes`, reachable only through
 * `app.visible_notes`. A client that wants to show what was just pinned has it in the
 * draft it submitted.
 */
export interface PinnedNote {
  readonly id: string;
  readonly recipientId: string;
  readonly createdAt: string;
}

/**
 * The author of a note on your board, under the same §6a disclosure rule the graph and
 * the board use.
 *
 * Absent name/handle/avatar means render none of them — see {@link import('./graph').Person}.
 *
 * ⚠ **Do not fill a missing name in from your own graph or from the connection you
 * remember making.** Pinning required a first-degree connection at the time; by the time
 * you read it that person may disclose less. What the server withheld, it withheld
 * deliberately.
 *
 * This type is the **partial** absence — somebody is there and you may not be told their
 * name. When there is no card at all, {@link Note.author} is absent instead: the author
 * has left your visible world entirely and not even `userId` is disclosed.
 */
export interface NoteAuthor {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * A note as its **recipient** sees it — one row of `notes.list`.
 *
 * ⚠ Carries no `recipientId`, not even optionally: the only person who can receive one of
 * these is the recipient, so the field could only ever say "you".
 */
export interface Note {
  readonly id: string;
  readonly body: string;
  /** ISO-8601, and the list arrives newest first. */
  readonly createdAt: string;
  /**
   * The author card, **absent when there is no longer an author to show**.
   *
   * The note is yours and it does not disappear with them. An absent card means the
   * person who wrote it has left your visible world — the connection was severed, they
   * deactivated, or they now sit beyond the bounds the graph traversal answers within —
   * and the server is withholding every one of their identifying columns, `userId`
   * included.
   *
   * ⚠ **Render no author line. Never a reconstructed one.** Not from a cached person, not
   * from your own graph, not from the connection you remember: an authorless note is the
   * server saying "you may read this message and you may not be told who it is from", and
   * filling that in locally is the same B5 person-projection bug as inventing a withheld
   * name (see {@link NoteAuthor}, which is the *partial* case — a card that is present but
   * unnamed).
   */
  readonly author?: NoteAuthor;
}
