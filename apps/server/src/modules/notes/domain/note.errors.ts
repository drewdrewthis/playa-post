import { ApplicationError } from '../../../shared/errors/application-error';

import { NOTE_BODY_MAX_LENGTH } from './note-content';

/**
 * The submitted note is empty, or longer than a note may be.
 *
 * The domain owns this rule rather than the tRPC input schema, for the reason
 * `modules/bulletins/domain/bulletin.errors.ts` gives: restating it at the transport
 * would make an over-long note come back as a generic `BAD_REQUEST` instead of a stable
 * code, and the `sync.submitMutations` path would then have to restate it a third time.
 *
 * It names the field it refused, which discloses nothing — the caller sent it.
 *
 * Unlike a bulletin, an **empty body is refused**. A bulletin may have an empty body
 * because its title carries it; a note has no title, so an empty note is a row with
 * nothing in it addressed to somebody who will be told they have mail.
 */
export class NoteContentInvalidError extends ApplicationError {
  static readonly code = 'NOTE_CONTENT_INVALID';

  constructor() {
    super(
      NoteContentInvalidError.code,
      `A note needs a body of 1 to ${String(NOTE_BODY_MAX_LENGTH)} characters.`,
    );
    this.name = 'NoteContentInvalidError';
  }
}

/**
 * The named recipient is not somebody this actor may pin a note to.
 *
 * **One answer for every refusal** — no such person, a person who exists but is not
 * connected to the actor, a person two hops away, a deactivated or erased account, and
 * the actor naming themselves — and the uniformity *is* the security property
 * (ADR-0002 §10, B17). Distinguishing "no such user" from "not connected" would answer
 * "yes, that UUID names somebody real" to anyone willing to ask twice, in a product
 * whose whole premise is that there is no people search.
 *
 * It is one class with one message for the reason
 * {@link import('../../bulletins/domain/bulletin.errors').BulletinGoneError} is: making
 * the cases indistinguishable *by construction* beats keeping several messages worded
 * identically, which is a property that holds until somebody improves one of them.
 *
 * ⚠ The message must never grow a detail. "That person is at two degrees", "they
 * removed you", or an echoed handle each turn this error back into the oracle it exists
 * to close.
 *
 * Declared here rather than reusing
 * `modules/connections/domain/connection.errors.ts`'s `NotConnectedError`: addendum §19
 * forbids importing another module's domain, and the two refusals are not the same
 * statement — that one is about a connection operation, this one is about a note.
 */
export class NoteRecipientUnreachableError extends ApplicationError {
  static readonly code = 'NOTE_RECIPIENT_UNREACHABLE';

  constructor() {
    super(
      NoteRecipientUnreachableError.code,
      'You can only pin a note to someone you are directly connected to.',
    );
    this.name = 'NoteRecipientUnreachableError';
  }
}
