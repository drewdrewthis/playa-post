import { validateTrust } from '../domain/connection-trust.policy';
import type { ConnectionTrustRepository } from '../domain/connection-trust.repository';
import { NotConnectedError } from '../domain/connection.errors';
import type { ConnectionRepository } from '../domain/connection.repository';

/**
 * What setting trust is given.
 *
 * `actorId` comes from the resolved `Actor`, never the request body. The field
 * naming the other person is `subjectUserId` rather than `userId` for a mechanical
 * reason as well as a semantic one: `userId` is on ADR-0002:180-181's forbidden list
 * and `tests/fitness/viewer-id-provenance.fitness.test.ts` fails the build on a
 * procedure input carrying it. "Subject" is also what the column is called.
 */
export interface SetConnectionTrustCommand {
  readonly actorId: string;
  readonly subjectUserId: string;
  /** Unvalidated as it arrives; {@link validateTrust} is the only way it reaches storage. */
  readonly trust: number;
}

export interface SetConnectionTrustService {
  set(command: SetConnectionTrustCommand): Promise<void>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SetConnectionTrustDependencies {
  readonly connections: ConnectionRepository;
  readonly trust: ConnectionTrustRepository;
  /** Reads the wall clock. Overridable so a test can pin `updated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The SetConnectionTrust use case (M2.6).
 *
 * **Actorship is settled first, before the value is even looked at.** ADR-0005:69-75
 * makes that ordering a hard invariant rather than a style preference: the conflict
 * envelope is a leak channel, so an actor who is not party to a connection must be
 * refused *before* anything compares versions or reads current state, and must
 * therefore receive a plain `NOT_CONNECTED` — never a conflict carrying
 * `currentState` for a connection between two other people (M2-AC3, B6, B13).
 *
 * The same ordering is what M2-AC19 measures from the outside: an unrelated actor
 * leaves zero rows in `app.connection_trust` and zero in `app.outbox_events`. There is
 * no outbox write on this path at all — trust is private by construction, so an event
 * announcing it would be the leak the whole table shape exists to prevent.
 *
 * Setting trust is an **upsert on (owner, subject)**, not an insert: an opinion has one
 * current value. Under this lane's ratified model the absence of a row is `unset`, so
 * this method is also the only thing that can move a connection out of that state —
 * accepting a connection deliberately writes no trust row (ADR-0004:70-71).
 */
export function createSetConnectionTrustService(
  dependencies: SetConnectionTrustDependencies,
): SetConnectionTrustService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async set(command: SetConnectionTrustCommand): Promise<void> {
      const connection = await dependencies.connections.findBetween(
        command.actorId,
        command.subjectUserId,
      );

      if (connection === null) {
        throw new NotConnectedError();
      }

      const trust = validateTrust(command.trust);

      await dependencies.trust.set({
        ownerId: command.actorId,
        subjectId: command.subjectUserId,
        trust,
        assignedAt: readClock(),
      });
    },
  };
}
