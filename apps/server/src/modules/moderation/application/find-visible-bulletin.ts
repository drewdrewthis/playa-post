/**
 * What this module is allowed to learn about a bulletin: that this actor can see it,
 * and who wrote it.
 *
 * Two fields would already be one too many if the second were not load-bearing:
 * `authorId` is what makes "you cannot report your own bulletin" decidable
 * (M2-AC18) and nothing else here uses it.
 */
export interface VisibleBulletinAuthorship {
  readonly authorId: string;
}

/**
 * The port onto "can this actor see that bulletin, and whose is it" — moderation's
 * only dependency on `modules/bulletins`.
 *
 * **A bare function rather than a repository-shaped interface, deliberately.**
 * `modules/bulletins` already owns a `VisibleBulletinsRepository`, and moderation may
 * not import its implementation (`no-cross-module-persistence`) or re-derive it — so a
 * port shaped like that repository would advertise methods this module can neither use
 * nor honestly implement in a test. The narrowest signature that answers the only
 * question moderation asks is the one that cannot grow into a second visibility rule
 * (ADR-0002 §6).
 *
 * @param actorId - The acting viewer, from the resolved `Actor`.
 * @returns `null` for **every** refusal — never existed, not authorized, archived. The
 *   caller turns all of them into one
 *   {@link import('../domain/moderation.errors').ModerationTargetUnavailableError}, so
 *   there is no branch here that could grow a distinguishing message and no information
 *   to distinguish with (M2-AC14, B17).
 */
export type FindVisibleBulletin = (
  actorId: string,
  bulletinId: string,
) => Promise<VisibleBulletinAuthorship | null>;
