import type { HiddenBulletin } from './hidden-bulletin';
import type { ReportReason } from './report-reason';

/** What recording a hide is given. */
export interface HideBulletinWrite {
  readonly bulletinId: string;
  /** The acting viewer, taken from the resolved `Actor` and never from request input. */
  readonly viewerId: string;
  readonly occurredAt: Date;
}

/**
 * What recording a **report** is given: a hide, plus what the reporter said about it.
 *
 * ⚠ A separate type rather than two optional fields on {@link HideBulletinWrite}, so a
 * dismissal *cannot* carry a reason. Dismissing is "not for me" and says nothing about
 * the bulletin or its author; a shared shape with two nullable fields would make an
 * accidental reasoned dismissal a typo rather than a compile error, and the row it wrote
 * would look like a report to whatever reads `app.bulletin_dismissals` next.
 */
export interface ReportBulletinWrite extends HideBulletinWrite {
  readonly reason: ReportReason;
  /**
   * The reporter's own account, already trimmed and bounded by
   * {@link import('./report-reason.policy').validateReportDetail}.
   *
   * ⚠ **Reporter-authored free text, and therefore reporter-identifying.** It is stored
   * beside `reporter_id` in the one table no author-facing read joins, and it is subject
   * to the same rule (M2-AC10, B9): it must never appear in a response the reported
   * author can reach, and no presenter in this module returns it.
   */
  readonly detail: string;
}

/**
 * The moderation port — `app.bulletin_reports` and `app.bulletin_dismissals`.
 *
 * Two tables behind one port because they answer one question in two moods: "which
 * bulletins has this viewer taken off their own board, and why did they say so". The
 * read ({@link ModerationRepository.findHiddenFor}) does not distinguish them at all,
 * which is the point — the board applies the same exclusion either way.
 *
 * ⚠ **No method here writes an outbox event, and none may.** M2-AC10's notifications
 * clause is proven by `app.outbox_events` gaining **zero** rows when a report is
 * recorded: with nothing published, there is no delivery a future notifications
 * consumer could be handed the reporter's identity through. A `BulletinReported` event
 * would undo that guarantee at a distance, and no test in the reporting module would
 * fail.
 *
 * ⚠ **No method takes an author, and no method returns one.** The author is the one
 * person who must never learn a report happened (B9); a port that could answer "who
 * reported this" is a port a future feature will answer it with.
 */
export interface ModerationRepository {
  /**
   * Record that a viewer privately reported a bulletin.
   *
   * Idempotent on `(bulletin_id, reporter_id)` — ADR-0005's matrix: "a second distinct
   * report of the same bulletin by the same reporter → `applied` no-op (one open report
   * per reporter/bulletin)". Converging rather than erroring, because the user-visible
   * state the second call asks for is the state that already holds.
   *
   * ⚠ **The first reason wins, and a second report does not overwrite it.** That is what
   * "one open report per reporter/bulletin" means, and it is the honest reading: the
   * reporter's first account is what they filed, and a silent `do update` would let a
   * re-report rewrite a statement a steward may already have acted on.
   */
  report(write: ReportBulletinWrite): Promise<HiddenBulletin>;

  /**
   * Record that a viewer dismissed a bulletin from their own board.
   *
   * Viewer-local and idempotent, exactly like {@link ModerationRepository.report} and
   * with no other effect anywhere (M2-AC11): no strike count, no aggregation, no signal
   * to the author.
   */
  dismiss(write: HideBulletinWrite): Promise<HiddenBulletin>;

  /**
   * Every bulletin this viewer has reported or dismissed.
   *
   * The read `modules/bulletins`' board consumes through its own
   * `HiddenBulletinsRepository` port. A `Set` rather than an array because the caller's
   * only question is membership, and because the two tables can name the same bulletin
   * — a viewer may dismiss something and later report it — which a list would surface
   * as a duplicate the caller has to know to ignore.
   */
  findHiddenFor(viewerId: string): Promise<ReadonlySet<string>>;
}
