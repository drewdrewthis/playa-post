import type { VisibleBulletinsRepository } from './visible-bulletins.repository';

/** Who wrote a bulletin the asking actor is authorized to see. */
export interface VisibleBulletinAuthorship {
  readonly authorId: string;
}

/**
 * This module's **public application interface for other modules** — "can this actor
 * see that bulletin, and whose is it".
 *
 * A bare function rather than a service object, because it is one question with one
 * answer and no state: the narrowest surface that satisfies its one consumer
 * (`modules/moderation`, which must know whether an actor may moderate a bulletin and
 * whether they are its author) is the surface that cannot quietly grow into a second
 * way to read bulletins. `no-cross-module-persistence` stops the reach-in; this is the
 * "small public application interface" §19 offers instead.
 *
 * @returns `null` for **every** refusal — never existed, not authorized, archived — so
 *   a consumer has nothing to distinguish them with and cannot build an existence
 *   oracle out of them (ADR-0002 §10, B17, M2-AC14).
 */
export type FindVisibleBulletinAuthor = (
  actorId: string,
  bulletinId: string,
) => Promise<VisibleBulletinAuthorship | null>;

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface FindVisibleBulletinAuthorDependencies {
  readonly bulletins: VisibleBulletinsRepository;
}

/**
 * Build the authorship lookup over the same authorized read `bulletins.getById` uses.
 *
 * ⚠ It composes {@link VisibleBulletinsRepository} rather than reading `app.bulletins`,
 * which is what makes a moderation call and a bulletin read answer the *same* question
 * about authorization. A cheaper `select author_id from app.bulletins where id = ?`
 * would be a second visibility predicate — one that says yes for a bulletin the actor
 * cannot see (ADR-0002 §6, R2).
 *
 * ⚠ It returns only `authorId`. The projected author card, the title, and the body all
 * come back from the repository and are dropped here on purpose: a consumer outside
 * this module has no business rendering a bulletin it did not read through this
 * module's own transport.
 */
export function createFindVisibleBulletinAuthorQuery(
  dependencies: FindVisibleBulletinAuthorDependencies,
): FindVisibleBulletinAuthor {
  return async (actorId: string, bulletinId: string) => {
    const bulletin = await dependencies.bulletins.findVisibleById(actorId, bulletinId);

    return bulletin === null ? null : { authorId: bulletin.author.userId };
  };
}
