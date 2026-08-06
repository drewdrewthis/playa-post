import type { Bulletin } from '../domain/bulletin';
import type { BulletinRepository } from '../domain/bulletin.repository';

/** What listing your own bulletins is given. Nothing but the resolved actor. */
export interface ListMyBulletinsCommand {
  readonly actorId: string;
}

export interface ListMyBulletinsQuery {
  list(command: ListMyBulletinsCommand): Promise<readonly Bulletin[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListMyBulletinsDependencies {
  readonly bulletins: BulletinRepository;
}

/**
 * The author's own bulletin list (M2.8) — `bulletins.listMine`, M2-AC12's retention
 * half.
 *
 * **Archived bulletins are included, and that is the point.** Archiving takes a
 * bulletin off every board — `app.visible_bulletins` filters it out for every viewer,
 * its author included — and this list is the one place it survives, with `archivedAt`
 * set. Two surfaces, two answers, no exception threaded through the visibility
 * function.
 *
 * It takes an `actorId` rather than a viewer, and composes no visibility function,
 * because there is no visibility question: the authorized set is the actor's own rows.
 * The command carries no filter and no other person's ID, so there is nothing here a
 * caller could aim at somebody else's bulletins.
 */
export function createListMyBulletinsQuery(
  dependencies: ListMyBulletinsDependencies,
): ListMyBulletinsQuery {
  return {
    async list(command: ListMyBulletinsCommand): Promise<readonly Bulletin[]> {
      return dependencies.bulletins.findByAuthor(command.actorId);
    },
  };
}
