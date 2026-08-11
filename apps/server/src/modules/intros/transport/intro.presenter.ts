import type { IntroPerson } from '../application/intro-person';
import type {
  IntroInboxRole,
  VisibleIntroInboxRow,
  VisibleIntroOutboxRow,
} from '../application/visible-intro';
import type { IntroRequest, IntroRequestStatus } from '../domain/intro-request';

/**
 * A person as this API renders one on an intro surface.
 *
 * The same shape as the {@link IntroPerson} read model, restated here rather than
 * re-exported, because the wire is a contract and the read model is an implementation
 * (the same argument `modules/notes`' and `modules/graph`'s presenters make).
 *
 * ⚠ Nothing is *added* here, and that is the rule ADR-0002 §6a states: every person
 * representation is projected through `app.visible_people`'s disclosure level, no
 * exceptions. A presenter that filled in a missing name from anywhere else — the
 * reader's own graph, a cache, the connection they remember — would be exactly the bug
 * B5's person-projection sub-case asserts against, and on an intro surface a reader is
 * unusually likely to believe they already know the answer.
 */
export interface PresentedIntroPerson {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * An intro request as this API renders one back to the actor who just changed it —
 * `intros.request`'s, `intros.decide`'s and `intros.respond`'s answer.
 *
 * One type for all three, because they answer the same question ("what does this row look
 * like now") to somebody who is already a party to it. Three near-identical types would be
 * three places for the status vocabulary to drift.
 *
 * ⚠ It carries **no `note`**, and that is a privacy rule rather than a saving. The
 * requester wrote it and the via has it on their inbox row; echoing it out of a mutation
 * would put a second copy of it wherever the caller stores mutation results — the copy
 * `modules/notes` refuses for the same reason (`PinnedNote` carries no `body`).
 *
 * ⚠ It carries **no person cards**. `viaUserId` and `targetUserId` are identifiers the
 * caller supplied themselves, so echoing them discloses nothing; a *card* would be a
 * person projection built on a write path, and every person projection in this system
 * comes off a read that composed `app.visible_people`.
 *
 * Timestamps are ISO-8601 strings rather than `Date`s. tRPC without a serializer turns a
 * `Date` into a string on the wire anyway, so declaring the string is declaring what a
 * client actually receives instead of a type that is true only in-process.
 */
export interface PresentedIntroRequest {
  readonly id: string;
  readonly viaUserId: string;
  readonly targetUserId: string;
  readonly status: IntroRequestStatus;
  readonly createdAt: string;
  /** Absent while the request is open. */
  readonly decidedAt?: string;
  /**
   * When the target answered (issue #166). Absent on every receipt but their own.
   *
   * Safe on this type precisely because a receipt goes only to the actor who just wrote
   * the row: `request` and `decide` can only ever match a row nobody has answered, so the
   * key is omitted for them, and `respond`'s reader is the target themselves. It reaches
   * no *read* — `intros.listOutbox` carries no answer of any kind, so a decline stays
   * indistinguishable from an introduction nobody has got to yet.
   */
  readonly respondedAt?: string;
}

/**
 * One row of the dual-role inbox — `intros.listInbox`'s rows.
 *
 * ⚠ `role` is the discriminator a client **must** branch on, and it is computed by the
 * server from which column matched. A `via` row is an open ask awaiting a decision and
 * carries both other parties; a `target` row is an introduction already made and carries
 * the requester only. A client that rendered a decide control on a `target` row would be
 * offering an action the server refuses.
 *
 * ⚠ All three cards are **optional**, because the request outlives the relationship that
 * carried it — see {@link VisibleIntroInboxRow}. An absent card means render no name at
 * all, never a reconstructed one.
 *
 * ⚠ A `target` row carries **two** notes and each belongs to a different person: `note`
 * is the requester's and `viaNote` is the via's vouch (#175). They are separate fields
 * rather than one joined string precisely so a client cannot render them under one name.
 */
export interface PresentedIntroInboxRow {
  readonly id: string;
  readonly role: IntroInboxRole;
  readonly note: string;
  /** The via's own note. `target` rows only, and absent on a pass-on that predates #175. */
  readonly viaNote?: string;
  readonly createdAt: string;
  readonly requester?: PresentedIntroPerson;
  /** Who passed it on. `target` rows only — on a `via` row the via is the reader. */
  readonly via?: PresentedIntroPerson;
  readonly target?: PresentedIntroPerson;
}

/**
 * One row of the requester's own record — `intros.listOutbox`'s rows.
 *
 * ⚠ No `note`: the requester wrote it. And no reason on a `declined` row, because there
 * is none to send — the via's rationale is theirs.
 */
export interface PresentedIntroOutboxRow {
  readonly id: string;
  readonly status: IntroRequestStatus;
  readonly targetUserId: string;
  readonly createdAt: string;
  /** Absent while the request is open. */
  readonly decidedAt?: string;
  readonly via?: PresentedIntroPerson;
}

/**
 * Project one already-projected person onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be there,
 * and "the field appeared in the response because someone added it upstream" is how §6a
 * gets violated by accident.
 */
function presentPerson(person: IntroPerson): PresentedIntroPerson {
  return {
    userId: person.userId,
    disclosure: person.disclosure,
    ...(person.displayName === undefined ? {} : { displayName: person.displayName }),
    ...(person.handle === undefined ? {} : { handle: person.handle }),
    ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
  };
}

/** Project the acting party's own view of a request they just wrote, decided or answered. */
export function presentIntroRequest(request: IntroRequest): PresentedIntroRequest {
  return {
    id: request.id,
    viaUserId: request.viaId,
    targetUserId: request.targetId,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt.toISOString() }),
    ...(request.respondedAt === undefined
      ? {}
      : { respondedAt: request.respondedAt.toISOString() }),
  };
}

/** Project one candidate via onto the wire. */
export function presentIntroPerson(person: IntroPerson): PresentedIntroPerson {
  return presentPerson(person);
}

/**
 * Project one inbox row onto the wire.
 *
 * An absent card stays absent: the key is omitted rather than set to `null`, so a
 * serialized row carries no `requester`/`target` property at all and there is nothing for
 * a client to render a placeholder into.
 */
export function presentIntroInboxRow(row: VisibleIntroInboxRow): PresentedIntroInboxRow {
  return {
    id: row.id,
    role: row.role,
    note: row.note,
    ...(row.viaNote === undefined ? {} : { viaNote: row.viaNote }),
    createdAt: row.createdAt.toISOString(),
    ...(row.requester === undefined ? {} : { requester: presentPerson(row.requester) }),
    ...(row.via === undefined ? {} : { via: presentPerson(row.via) }),
    ...(row.target === undefined ? {} : { target: presentPerson(row.target) }),
  };
}

/** Project one outbox row onto the wire. */
export function presentIntroOutboxRow(row: VisibleIntroOutboxRow): PresentedIntroOutboxRow {
  return {
    id: row.id,
    status: row.status,
    targetUserId: row.targetId,
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt === undefined ? {} : { decidedAt: row.decidedAt.toISOString() }),
    ...(row.via === undefined ? {} : { via: presentPerson(row.via) }),
  };
}
