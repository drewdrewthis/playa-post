import type { HiddenBulletin } from '../domain/hidden-bulletin';
import { ModerationTargetUnavailableError } from '../domain/moderation.errors';
import type { ModerationRepository } from '../domain/moderation.repository';

import type { FindVisibleBulletin } from './find-visible-bulletin';

/**
 * What dismissing a bulletin is given.
 *
 * ⚠ `actorId` comes from the resolved `Actor`, never from request input
 * (ADR-0002:180-181, B14): a dismissal names the board it changes, and a caller
 * supplying the viewer could clear somebody else's.
 */
export interface DismissBulletinCommand {
  readonly actorId: string;
  readonly bulletinId: string;
}

export interface DismissBulletinService {
  dismiss(command: DismissBulletinCommand): Promise<HiddenBulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DismissBulletinDependencies {
  readonly moderation: ModerationRepository;
  /** See {@link FindVisibleBulletin} — the module's one edge onto `modules/bulletins`. */
  readonly findVisibleBulletin: FindVisibleBulletin;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The dismiss use case (M2.12) — **viewer-local and nothing else** (M2-AC11).
 *
 * Two steps: prove the actor may see the bulletin, then record that they no longer want
 * to. The visibility read is not ceremony — it is ADR-0005 precedence rule 1 applied to
 * a mutation whose subject is somebody else's bulletin, and it is what keeps
 * `app.bulletin_dismissals` from becoming a place an unrelated actor can write a row
 * naming any UUID they like.
 *
 * **Unlike {@link import('./report-bulletin.service').ReportBulletinService}, an author
 * may dismiss their own bulletin.** Dismissal says "not on my board"; an author who has
 * seen their own post enough times is making a statement about their own view, which is
 * exactly what this operation is for. Reporting is refused for one's own bulletin
 * because it means "this is unwanted content" and archiving is the author's tool for
 * that.
 *
 * ⚠ **No outbox event.** Same reason as reporting, and one more: a dismissal is a
 * preference, and a preference that published an event would be a preference other
 * people could observe.
 */
export function createDismissBulletinService(
  dependencies: DismissBulletinDependencies,
): DismissBulletinService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async dismiss(command: DismissBulletinCommand): Promise<HiddenBulletin> {
      const target = await dependencies.findVisibleBulletin(command.actorId, command.bulletinId);

      if (target === null) {
        throw new ModerationTargetUnavailableError();
      }

      return dependencies.moderation.dismiss({
        bulletinId: command.bulletinId,
        viewerId: command.actorId,
        occurredAt: readClock(),
      });
    },
  };
}
