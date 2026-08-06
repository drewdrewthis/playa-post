import { BulletinGoneError } from '../domain/bulletin.errors';

import type { VisibleBulletin } from './visible-bulletin';
import type { VisibleBulletinsRepository } from './visible-bulletins.repository';

/**
 * What fetching one bulletin is given.
 *
 * `actorId` comes from the resolved `Actor`; `bulletinId` is the caller's whole claim.
 */
export interface GetBulletinCommand {
  readonly actorId: string;
  readonly bulletinId: string;
}

export interface GetBulletinQuery {
  getById(command: GetBulletinCommand): Promise<VisibleBulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface GetBulletinDependencies {
  readonly bulletins: VisibleBulletinsRepository;
}

/**
 * The single-bulletin read (M2.8) — `bulletins.getById`.
 *
 * **The `null`-to-error translation on line one is the whole security property.**
 * `app.visible_bulletins` answers "nothing" identically for a bulletin that never
 * existed, one this viewer may not see, and one its author archived; this query turns
 * all three into one {@link BulletinGoneError} without ever learning which it was.
 * There is no branch here that could grow a distinguishing message, because there is no
 * information here to distinguish with — which is how M2-AC14's byte-identical-bodies
 * requirement and ADR-0002 B17 hold by construction rather than by review.
 *
 * ⚠ Do not add a "does it exist" pre-read to improve the message. That read is the
 * existence oracle §10 forbids, and it would be invisible in the response it improved.
 */
export function createGetBulletinQuery(dependencies: GetBulletinDependencies): GetBulletinQuery {
  return {
    async getById(command: GetBulletinCommand): Promise<VisibleBulletin> {
      const bulletin = await dependencies.bulletins.findVisibleById(
        command.actorId,
        command.bulletinId,
      );

      if (bulletin === null) {
        throw new BulletinGoneError();
      }

      return bulletin;
    },
  };
}
