import { ModerationTargetUnavailableError } from '../domain/moderation.errors';
import type { ModerationRepository } from '../domain/moderation.repository';
import type { RestoredBulletin } from '../domain/restored-bulletin';

import type { FindVisibleBulletin } from './find-visible-bulletin';

/**
 * What un-dismissing a bulletin is given.
 *
 * ⚠ `actorId` comes from the resolved `Actor`, never from request input
 * (ADR-0002:180-181, B14) — the same rule
 * {@link import('./dismiss-bulletin.service').DismissBulletinCommand} states, and for a
 * sharper reason in this direction: a caller supplying the viewer could put a bulletin
 * back onto somebody else's board.
 */
export interface UndismissBulletinCommand {
  readonly actorId: string;
  readonly bulletinId: string;
}

export interface UndismissBulletinService {
  undismiss(command: UndismissBulletinCommand): Promise<RestoredBulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface UndismissBulletinDependencies {
  readonly moderation: ModerationRepository;
  /** See {@link FindVisibleBulletin} — the module's one edge onto `modules/bulletins`. */
  readonly findVisibleBulletin: FindVisibleBulletin;
  /**
   * Reads the wall clock. Overridable so a test can pin it.
   *
   * Carried even though a delete stamps nothing, because
   * {@link import('../domain/moderation.repository').HideBulletinWrite} is the shape every
   * viewer-local write in this module takes — one shape the three operations share, rather
   * than a fourth that exists only to be one field shorter.
   */
  readonly now?: (() => Date) | undefined;
}

/**
 * The un-dismiss use case (#170) — the way back out of the Dismissed category.
 *
 * **The same two steps as {@link import('./dismiss-bulletin.service').DismissBulletinService},
 * in the same order, and the symmetry is deliberate.** Prove the actor may see the
 * bulletin, then record that they want it back. Both paths — the tRPC procedure and a
 * replayed offline envelope — then agree about what an actor may do to a bulletin, which
 * is what ADR-0005 requires and what keeps `bulletin.undismiss`'s pre-dispatch actorship
 * gate meaningful rather than vacuous.
 *
 * The visibility read is not ceremony even though the delete below is already scoped to
 * the actor's own row. Without it, `moderation.undismiss` would answer differently from
 * every other procedure that names a bulletin: a caller could tell a bulletin they may not
 * see from one that never existed by watching which UUIDs are accepted, which is precisely
 * the distinction ADR-0002 §10 and B17 close.
 *
 * ⚠ **Idempotent, and un-dismissing something never dismissed is a success.** There is no
 * "you had not dismissed this" refusal, because the state the caller asked for is the state
 * that already holds — the same convergence a repeated dismissal gets from the other side.
 *
 * ⚠ **No outbox event**, for the two reasons dismissal gives: nothing outside this viewer's
 * board changed, and a preference that published an event would be a preference other people
 * could observe.
 */
export function createUndismissBulletinService(
  dependencies: UndismissBulletinDependencies,
): UndismissBulletinService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async undismiss(command: UndismissBulletinCommand): Promise<RestoredBulletin> {
      const target = await dependencies.findVisibleBulletin(command.actorId, command.bulletinId);

      if (target === null) {
        throw new ModerationTargetUnavailableError();
      }

      return dependencies.moderation.undismiss({
        bulletinId: command.bulletinId,
        viewerId: command.actorId,
        occurredAt: readClock(),
      });
    },
  };
}
