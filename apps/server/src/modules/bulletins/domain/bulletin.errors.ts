import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The bulletin is not there for you.
 *
 * **One answer for four situations** — it does not exist, it exists and you may not
 * see it, it exists and you are not its author, it existed and has been archived — and
 * the uniformity *is* the security property (ADR-0002 §10, B17, M2-AC14).
 *
 * Visibility is the product, so "does this exist" is itself protected information. A
 * distinct `BULLETIN_FORBIDDEN` beside a `BULLETIN_NOT_FOUND` would answer "yes, that
 * UUID names something real" to anyone willing to ask twice, and a distinct
 * `BULLETIN_ARCHIVED` would additionally answer "and its author took it down". The
 * same discipline `connections/domain/connection.errors.ts`'s `NotConnectedError` and
 * `invitation.errors.ts`'s `InvitationUnavailableError` already establish.
 *
 * Making the four cases *one class with one message* is what makes M2-AC14's
 * byte-identical-bodies requirement true **by construction**. The alternative — four
 * errors that a reviewer must keep worded identically — is a property that holds until
 * somebody improves one message.
 *
 * ⚠ The message must never grow a detail. "This bulletin belongs to someone else",
 * "archived on 3 June", or an echoed bulletin ID each turn this error back into the
 * oracle it exists to close.
 *
 * It is also the archive path's refusal (M2-AC18/M2-AC19): an actor who is not the
 * author gets exactly what an actor naming a never-existent UUID gets, and ADR-0005's
 * precedence rule 1 is satisfied by construction — actorship decides the answer before
 * any version is compared, so no conflict envelope carrying `currentState` can be
 * emitted to somebody who is not party to the bulletin.
 */
export class BulletinGoneError extends ApplicationError {
  static readonly code = 'BULLETIN_GONE';

  constructor() {
    super(BulletinGoneError.code, 'That bulletin is not available.');
    this.name = 'BulletinGoneError';
  }
}

/**
 * The submitted title or body is outside the bounds a bulletin may carry.
 *
 * The domain owns this rule rather than the tRPC input schema, for the reason
 * `modules/identity/transport/complete-onboarding.input.ts` gives: restating it at the
 * transport would make an over-long body come back as a generic `BAD_REQUEST` instead
 * of the stable code M2-AC18 requires, and the `sync.submitMutations` path (M2.13)
 * would then have to restate it a third time.
 *
 * @param field - Which of the three was refused, so the client can put the message
 *   beside the right input. Naming a field the caller sent discloses nothing.
 * @param maxLength - The bound that was exceeded, passed in rather than imported:
 *   `bulletin-content.policy.ts` already imports this class, and importing its
 *   constants back would be a cycle between the rule and its refusal.
 */
export class BulletinContentInvalidError extends ApplicationError {
  static readonly code = 'BULLETIN_CONTENT_INVALID';

  constructor(field: 'title' | 'body' | 'loc', maxLength: number) {
    super(BulletinContentInvalidError.code, messageFor(field, maxLength));
    this.name = 'BulletinContentInvalidError';
  }
}

/** The one sentence each refused field gets. Separate so the constructor stays a line. */
function messageFor(field: 'title' | 'body' | 'loc', maxLength: number): string {
  switch (field) {
    case 'title':
      return `A bulletin needs a title of 1 to ${String(maxLength)} characters.`;
    case 'body':
      return `A bulletin body may be at most ${String(maxLength)} characters.`;
    case 'loc':
      return `A bulletin location may be at most ${String(maxLength)} characters.`;
  }
}

/**
 * The submitted expiry has already passed.
 *
 * Its own code rather than a fourth `field` on {@link BulletinContentInvalidError}:
 * that error's contract is "a length bound was exceeded", and its `maxLength` argument
 * has no meaning for a moment in time. A client shows this beside the expiry control
 * and the length message beside a text input, which is only possible if the two are
 * distinguishable without parsing prose.
 *
 * Discloses nothing: the caller sent the value being refused.
 */
export class BulletinExpiryInvalidError extends ApplicationError {
  static readonly code = 'BULLETIN_EXPIRY_INVALID';

  constructor() {
    super(
      BulletinExpiryInvalidError.code,
      'A bulletin can only be set to expire at a moment that has not yet passed.',
    );
    this.name = 'BulletinExpiryInvalidError';
  }
}
