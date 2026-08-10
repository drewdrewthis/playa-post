import type { IntroRequestStatus } from '../domain/intro-request';

import type { IntroPerson } from './intro-person';

/**
 * Which side of an intro the reader is standing on.
 *
 * `intros.listInbox` is **dual-role**, and this is the discriminator that makes the two
 * halves safe to serve from one procedure: a `via` row is an open ask waiting on a
 * decision, a `target` row is an introduction that has already been passed on. No other
 * combination is ever returned — a target never sees a `requested` row and never sees a
 * `declined` one, which is the invariant the whole feature rests on.
 */
export const INTRO_INBOX_ROLE = {
  /** You were asked to make this introduction. Carries both other parties. */
  via: 'via',
  /** Somebody was introduced to you. Carries the requester only — the target is you. */
  target: 'target',
} as const;

/** One of {@link INTRO_INBOX_ROLE}'s values. */
export type IntroInboxRole = (typeof INTRO_INBOX_ROLE)[keyof typeof INTRO_INBOX_ROLE];

/**
 * One row of the reader's intro inbox.
 *
 * ⚠ **The note body is carried on both roles, and on no other read.** The via needs it
 * to decide; the target needs it because it is the whole of what the introduction says.
 * The requester's own `intros.listOutbox` does *not* carry it — they wrote it, and
 * echoing it back would put a second copy somewhere with no gate on it, which is the
 * copy `modules/notes` refuses for the same reason.
 *
 * ⚠ **Every person card is optional**, for the reason a note's author card is: the
 * request outlives the relationship that carried it. A via whose connection to the
 * requester was severed still sees the ask they were sent — with no card on it, because
 * `app.visible_people` no longer projects that person for them. What must never happen
 * is a card assembled from anywhere else, so a missing card is an omitted key rather
 * than a bare identifier a client could render.
 */
export interface VisibleIntroInboxRow {
  readonly id: string;
  readonly role: IntroInboxRole;
  readonly note: string;
  readonly createdAt: Date;
  /** Who asked. Absent when the reader may not be told who they are. */
  readonly requester?: IntroPerson;
  /**
   * Who they want to meet.
   *
   * Present only on a `via` row. On a `target` row the target is the reader, so the
   * field could only ever say "you" — the same reason `notes.list` carries no
   * `recipientId`.
   */
  readonly target?: IntroPerson;
}

/**
 * One row of the requester's own outbox — what they asked, and what came of it.
 *
 * Carries all three states (AC25). `requested` renders as "Intro pending via {name}";
 * `declined` renders as "not passed on", with **no reason and no re-ask control** — the
 * via's rationale is theirs, and a re-ask button would turn a decline into a prompt.
 *
 * ⚠ **No note body**, deliberately — see {@link VisibleIntroInboxRow}.
 *
 * `targetId` is a bare identifier rather than a card, and that is not an oversight: the
 * requester supplied it, so echoing it back discloses nothing (the same argument
 * `PinnedNote.recipientId` makes), and it is what lets the person sheet key its pending
 * state to a person it is already rendering from `graph.list`.
 */
export interface VisibleIntroOutboxRow {
  readonly id: string;
  readonly status: IntroRequestStatus;
  readonly targetId: string;
  readonly createdAt: Date;
  /** Absent while the request is open — `(status = 'requested') = (decidedAt absent)`. */
  readonly decidedAt?: Date;
  /** Who was asked. Absent when the requester may no longer be told who they are. */
  readonly via?: IntroPerson;
}
