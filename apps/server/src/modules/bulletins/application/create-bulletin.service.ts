import type { Bulletin, BulletinType } from '../domain/bulletin';
import { validateBulletinContent } from '../domain/bulletin-content.policy';
import type { BulletinRepository } from '../domain/bulletin.repository';

/**
 * What creating a bulletin is given.
 *
 * `authorId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14). That is also why
 * `bulletin.create` has no unrelated-actor case for M2-AC19 to exercise: there is no
 * subject for an actor to be unrelated *to* until the bulletin exists, so this
 * mutation is fail-closed by construction rather than by a runtime check.
 */
export interface CreateBulletinCommand {
  readonly authorId: string;
  /** M2 writes one type; see {@link BulletinType}. */
  readonly type: BulletinType;
  readonly title: string;
  readonly body: string;
}

export interface CreateBulletinService {
  create(command: CreateBulletinCommand): Promise<Bulletin>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface CreateBulletinDependencies {
  readonly bulletins: BulletinRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The create-bulletin use case (M2.8).
 *
 * Two steps and no third: validate the content, then hand one atomic write to the
 * repository. The `BulletinCreated` outbox row is written **inside that same
 * transaction** — see {@link BulletinRepository.add} — rather than published from here,
 * because publishing after a commit is the dual-write bug ADR-0006 exists to prevent
 * and M2-AC6 measures.
 *
 * There is deliberately no per-author rate limit, no duplicate-title check, and no
 * `mutationId` idempotency: replay idempotency is the sync envelope's job (ADR-0005,
 * M2.13), and putting a second implementation of it here would give the two paths two
 * answers for one duplicated create.
 */
export function createCreateBulletinService(
  dependencies: CreateBulletinDependencies,
): CreateBulletinService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async create(command: CreateBulletinCommand): Promise<Bulletin> {
      const content = validateBulletinContent({ title: command.title, body: command.body });

      return dependencies.bulletins.add({
        authorId: command.authorId,
        type: command.type,
        title: content.title,
        body: content.body,
        createdAt: readClock(),
      });
    },
  };
}
