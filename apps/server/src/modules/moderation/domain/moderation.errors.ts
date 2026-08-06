import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The bulletin is not there for you to moderate.
 *
 * **One answer for three situations** — it never existed, it exists and you are not
 * authorized to see it, it existed and has been archived — and the uniformity *is* the
 * security property (ADR-0002 §10, B17, M2-AC14). It is the same discipline
 * `bulletins/domain/bulletin.errors.ts`'s `BulletinGoneError` establishes, stated again
 * here rather than imported: a moderation refusal must not become distinguishable from
 * a bulletin refusal by the fact that one module reworded the other's message.
 *
 * Making the three cases *one class with one message* is what makes M2-AC14's
 * byte-identical-bodies requirement true **by construction** — the alternative is three
 * errors a reviewer must keep worded identically, which holds until somebody improves
 * one of them.
 *
 * ⚠ The message must never grow a detail. "You are not connected to that person" or an
 * echoed bulletin ID each turn this error back into the existence oracle it exists to
 * close.
 */
export class ModerationTargetUnavailableError extends ApplicationError {
  static readonly code = 'MODERATION_TARGET_UNAVAILABLE';

  constructor() {
    super(ModerationTargetUnavailableError.code, 'That bulletin is not available.');
    this.name = 'ModerationTargetUnavailableError';
  }
}

/**
 * You wrote it; report is not the tool for that.
 *
 * A distinct code from {@link ModerationTargetUnavailableError} — and safely so, unlike
 * every other distinction this module could draw. It discloses only what the caller
 * already knows: that they are the author, which they learned by writing it. Archiving
 * is the operation for an author who wants their own bulletin gone (M2-AC12), and a
 * self-report would otherwise sit in `app.bulletin_reports` as a permanent, private
 * self-hide with no way back in M2.
 */
export class CannotReportOwnBulletinError extends ApplicationError {
  static readonly code = 'BULLETIN_REPORT_OWN_NOT_ALLOWED';

  constructor() {
    super(
      CannotReportOwnBulletinError.code,
      'You cannot report your own bulletin — archive it instead.',
    );
    this.name = 'CannotReportOwnBulletinError';
  }
}
