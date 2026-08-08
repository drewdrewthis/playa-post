import type { HiddenBulletin } from '../domain/hidden-bulletin';
import {
  CannotReportOwnBulletinError,
  ModerationTargetUnavailableError,
} from '../domain/moderation.errors';
import type { ModerationRepository } from '../domain/moderation.repository';
import type { ReportReason } from '../domain/report-reason';
import { validateReportDetail } from '../domain/report-reason.policy';

import type { FindVisibleBulletin } from './find-visible-bulletin';

/**
 * What reporting a bulletin is given.
 *
 * ⚠ `actorId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14) — a caller naming the
 * reporter could file a report in somebody else's name against a bulletin that person
 * cannot even see.
 */
export interface ReportBulletinCommand {
  readonly actorId: string;
  readonly bulletinId: string;
  /** Which of the five kinds the reporter chose. Never defaulted — see the service. */
  readonly reason: ReportReason;
  /** The reporter's account of what happened, as typed. Trimmed and bounded here. */
  readonly detail: string;
}

export interface ReportBulletinService {
  report(command: ReportBulletinCommand): Promise<HiddenBulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ReportBulletinDependencies {
  readonly moderation: ModerationRepository;
  /** See {@link FindVisibleBulletin} — the module's one edge onto `modules/bulletins`. */
  readonly findVisibleBulletin: FindVisibleBulletin;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The report use case (M2.12) — private, immediate, and invisible to the author.
 *
 * **Four steps, in this order, and the order is ADR-0005 precedence rule 1.**
 * Authorization is resolved *before* anything else is decided and before any row is
 * written, so an actor with no relationship to the bulletin never reaches a branch that
 * could tell them something — not that it exists, not who wrote it, not that they are
 * or are not its author. That is why the visibility read comes first and the
 * own-bulletin check second: reversing them would answer "you are not the author" to
 * someone who is not entitled to know the bulletin exists.
 *
 * ⚠ **Validating the detail is the last of the four, and must stay last.** It is the one
 * refusal that describes the caller's own submission, so it is safe *only* once
 * authorization has already been settled — hoisted above the visibility read it becomes
 * an existence oracle, because `REPORT_DETAIL_INVALID` and
 * `MODERATION_TARGET_UNAVAILABLE` would then answer two different questions about a
 * bulletin the caller may not see.
 *
 * **What a report now carries, and what it still does not.** The comp asks *what kind*
 * and *what happened* (`design/Playa Post.dc.html:337-356`), and both are recorded. There
 * is still no strike count, no aggregation, no operator queue, and no notification — all
 * M5, and each of them is a way for a private act to become visible. The whole M2 effect
 * remains one row and one exclusion from one board; the row simply now says what the
 * reporter said.
 *
 * ⚠ **No outbox event, and that absence is the proof of M2-AC10's notifications
 * clause.** With zero rows written to `app.outbox_events`, there is nothing a future
 * notifications consumer could read the reporter's identity out of — a guarantee that
 * holds without `modules/notifications` existing yet, which is what makes it assertable
 * from this lane at all.
 */
export function createReportBulletinService(
  dependencies: ReportBulletinDependencies,
): ReportBulletinService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async report(command: ReportBulletinCommand): Promise<HiddenBulletin> {
      const target = await dependencies.findVisibleBulletin(command.actorId, command.bulletinId);

      if (target === null) {
        throw new ModerationTargetUnavailableError();
      }
      if (target.authorId === command.actorId) {
        throw new CannotReportOwnBulletinError();
      }

      const detail = validateReportDetail(command.detail);

      return dependencies.moderation.report({
        bulletinId: command.bulletinId,
        viewerId: command.actorId,
        occurredAt: readClock(),
        reason: command.reason,
        detail,
      });
    },
  };
}
