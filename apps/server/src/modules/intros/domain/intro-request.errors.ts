import { ApplicationError } from '../../../shared/errors/application-error';

import { INTRO_NOTE_MAX_LENGTH } from './intro-note';

/**
 * The submitted note is empty, or longer than an intro note may be.
 *
 * The domain owns this rule rather than the tRPC input schema, for the reason
 * `modules/notes/domain/note.errors.ts` gives: restating it at the transport would make
 * an over-long note come back as a generic `BAD_REQUEST` instead of a stable code.
 *
 * It names the field it refused, which discloses nothing — the caller sent it.
 *
 * ⚠ **Content validation runs before eligibility**, so an invalid note aimed at somebody
 * the requester cannot reach answers `INTRO_CONTENT_INVALID` and never
 * `INTRO_UNAVAILABLE`. That ordering is a privacy rule rather than an ergonomic one: if
 * the two were the other way round, a caller could learn reachability by sending
 * deliberate rubbish and reading which refusal came back.
 */
export class IntroContentInvalidError extends ApplicationError {
  static readonly code = 'INTRO_CONTENT_INVALID';

  constructor() {
    super(
      IntroContentInvalidError.code,
      `An intro needs a note of 1 to ${String(INTRO_NOTE_MAX_LENGTH)} characters.`,
    );
    this.name = 'IntroContentInvalidError';
  }
}

/**
 * There is no intro here for this actor to make or to decide.
 *
 * **One answer for every refusal**, and the uniformity *is* the security property
 * (ADR-0002 §10, B17). It covers, on the request path: no such person, a target at
 * degree 1, at degree 3 or beyond, absent from the requester's graph, deactivated, the
 * requester themselves, a target whose own `visible_to_distance` excludes the requester,
 * a `viaUserId` that is a real first-degree connection but not a shared one, and a
 * request that is already open for the pair. And on the decide path: no such request,
 * a request that is not yours to decide, one already decided, and one whose eligibility
 * has lapsed since it was made.
 *
 * Serializing every one of those responses into a `Set` must yield exactly one element.
 * Distinguishing any of them would answer "yes, that UUID names somebody real" — or
 * "yes, those two know each other" — to anyone willing to ask twice, in a product whose
 * whole premise is that there is no people search.
 *
 * It is one class with one message for the reason
 * {@link import('../../notes/domain/note.errors').NoteRecipientUnreachableError} is:
 * making the cases indistinguishable *by construction* beats keeping several messages
 * worded identically, which is a property that holds until somebody improves one of
 * them.
 *
 * ⚠ The message must never grow a detail. "That person is three hops away", "they
 * already declined", "somebody else got there first", or an echoed handle each turn this
 * error back into the oracle it exists to close.
 */
export class IntroUnavailableError extends ApplicationError {
  static readonly code = 'INTRO_UNAVAILABLE';

  constructor() {
    super(
      IntroUnavailableError.code,
      'That introduction is not available.',
    );
    this.name = 'IntroUnavailableError';
  }
}
