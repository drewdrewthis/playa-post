import type { Bulletin } from '../domain/bulletin';
import type { BulletinRepository } from '../domain/bulletin.repository';

/**
 * What archiving is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary, never from
 * the request body (ADR-0002:180-181). `bulletinId` is the only thing the caller
 * supplies, and naming one they do not own gets them
 * {@link import('../domain/bulletin.errors').BulletinGoneError} — the same answer a
 * never-existent UUID gets.
 */
export interface ArchiveBulletinCommand {
  readonly actorId: string;
  readonly bulletinId: string;
}

export interface ArchiveBulletinService {
  archive(command: ArchiveBulletinCommand): Promise<Bulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ArchiveBulletinDependencies {
  readonly bulletins: BulletinRepository;
  /** Reads the wall clock. Overridable so a test can pin `archived_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The archive-bulletin use case (M2.8) — the second and last mutation M2 ships.
 *
 * **Thin on purpose, and the thinness is the authorization design.** There is no
 * read-then-check-then-write here: {@link BulletinRepository.archive} makes actorship
 * and liveness part of the `where` clause of one conditional update, so a non-author
 * cannot win a race against a check that already passed. ADR-0005 precedence rule 1
 * requires actorship to be settled **before** version comparison so that an unrelated
 * actor never receives a conflict envelope carrying `currentState`; here it is settled
 * before anything at all is read back, which satisfies the rule with no ordering for a
 * future editor to get wrong.
 *
 * Idempotent (ADR-0005's matrix: `bulletin.archive`, `expectedVersion: no`, "already
 * archived → `applied`"). A second call returns the first `archivedAt` unchanged and
 * emits no second event — the repository decides that, because "did this write change
 * anything" is a fact about the statement, not something a service can infer after it.
 */
export function createArchiveBulletinService(
  dependencies: ArchiveBulletinDependencies,
): ArchiveBulletinService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async archive(command: ArchiveBulletinCommand): Promise<Bulletin> {
      const { bulletin } = await dependencies.bulletins.archive({
        actorId: command.actorId,
        bulletinId: command.bulletinId,
        occurredAt: readClock(),
      });

      return bulletin;
    },
  };
}
