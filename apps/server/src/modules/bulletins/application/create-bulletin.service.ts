import type { Bulletin, BulletinType } from '../domain/bulletin';
import { validateBulletinContent } from '../domain/bulletin-content.policy';
import { validateBulletinExpiry } from '../domain/bulletin-expiry.policy';
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
  /** One of the six postable types (#87); see {@link BulletinType}. */
  readonly type: BulletinType;
  readonly title: string;
  readonly body: string;
  /**
   * Free-text place. Absent means the bulletin names none.
   *
   * Optional rather than `string | null`, and the difference is who may omit it: this
   * is the *submitted* value, and a transport that never learned about locations must
   * still be able to build a valid command.
   */
  readonly loc?: string | undefined;
  /** When it stops being visible. Absent means never. Must not already have passed. */
  readonly expiresAt?: Date | undefined;
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
 * Three steps and no fourth: validate the content, validate the expiry against this
 * service's own clock, then hand one atomic write to the repository. Both policies run
 * here rather than at the transport, so `sync.submitMutations`' offline replay reaches
 * the same rules by running the same use case — a second copy at either boundary is a
 * second answer for one of the two paths. The `BulletinCreated` outbox row is written
 * **inside that same transaction** — see {@link BulletinRepository.add} — rather than
 * published from here,
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
      const content = validateBulletinContent({
        title: command.title,
        body: command.body,
        loc: command.loc,
      });
      // One clock reading for both, so a bulletin can never be stamped `created_at`
      // after the moment its expiry was checked against.
      const createdAt = readClock();
      const expiresAt = validateBulletinExpiry(command.expiresAt, createdAt);

      return dependencies.bulletins.add({
        authorId: command.authorId,
        type: command.type,
        title: content.title,
        body: content.body,
        loc: content.loc,
        expiresAt,
        createdAt,
      });
    },
  };
}
