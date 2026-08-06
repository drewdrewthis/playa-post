import type { HiddenBulletin } from './hidden-bulletin';

/** What recording a hide is given. */
export interface HideBulletinWrite {
  readonly bulletinId: string;
  /** The acting viewer, taken from the resolved `Actor` and never from request input. */
  readonly viewerId: string;
  readonly occurredAt: Date;
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
   */
  report(write: HideBulletinWrite): Promise<HiddenBulletin>;

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
