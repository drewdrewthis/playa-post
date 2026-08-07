import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The notification is not there for you.
 *
 * **One answer for three situations** — it never existed, it is somebody else's, or its
 * window has aged past ADR-0006's fourteen-day retention — and the uniformity is the
 * point, the same discipline `modules/bulletins`' `BulletinGoneError` and
 * `modules/moderation`'s `ModerationTargetUnavailableError` already establish. A
 * distinct "not yours" would confirm that a guessed identifier names a real
 * notification belonging to somebody, which is a fact about another person's activity.
 *
 * ⚠ It exists so that `notifications.dismiss` has to *check* rather than write blindly.
 * An unchecked dismissal would let any authenticated caller write an unbounded number of
 * rows keyed on invented identifiers — an abuse surface with no upper bound, which is
 * the reason `BULLETIN_TITLE_MAX_LENGTH` exists for its own field. Checking costs one
 * indexed read and turns the table into a record of real facts about the caller.
 */
export class NotificationUnavailableError extends ApplicationError {
  static readonly code = 'NOTIFICATION_UNAVAILABLE';

  constructor() {
    super(NotificationUnavailableError.code, 'That notification is not available.');
    this.name = 'NotificationUnavailableError';
  }
}
