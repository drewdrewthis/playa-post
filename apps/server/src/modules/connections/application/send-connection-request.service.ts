import type { ConnectionRequest } from '../domain/connection-request';
import { liveRequestFloor, rateWindowFloor } from '../domain/connection-request.policy';
import type { ConnectionRequestRepository } from '../domain/connection-request.repository';

/**
 * What sending a request is given.
 *
 * `requesterId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14). `slug` is the only thing
 * the caller supplies. There is no `ownerId` field and there must never be one: naming the
 * owner directly would make this a way to request a connection with anybody whose id you
 * could guess, which is the entire reason the link exists.
 */
export interface SendConnectionRequestCommand {
  readonly requesterId: string;
  readonly slug: string;
}

export interface SendConnectionRequestService {
  send(command: SendConnectionRequestCommand): Promise<ConnectionRequest>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SendConnectionRequestDependencies {
  readonly connectionRequests: ConnectionRequestRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at` and both floors. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The send-a-connection-request use case (issue #206).
 *
 * One step and no second: read the clock once, then hand one atomic write to the
 * repository.
 *
 * ⚠ **Authorization and every limit are deliberately absent from this file.** "Does this
 * slug resolve", "is that my own link", "are we already connected", "did I already ask",
 * "is their inbox full" and "is this link being hammered" are all decided by the `WHERE`
 * and the `ON CONFLICT` inside the repository's single insert, not by checks here — because
 * a check here would be a read the write could then race, and the losing half of that race
 * writes a row the rules refused. This service must never grow a copy of any of them: two
 * places deciding who may ask is two answers, and the cheaper one always wins the race.
 *
 * ⚠ **One clock reading, used for three things**, so the row's `created_at` and both
 * windows it is measured against come from the same instant. Reading the clock per floor
 * would make a request that arrived on a boundary count itself, or not, depending on which
 * microsecond each read landed in.
 *
 * There is deliberately no `mutationId` idempotency. Replay idempotency is the sync
 * envelope's job (ADR-0005) — and this mutation is not offline-queueable anyway, for the
 * reason `intros.request` is not: the link can rotate and the pair can connect while an
 * envelope waits, so a queued ask could drain into a world where it is no longer the ask
 * anybody made.
 */
export function createSendConnectionRequestService(
  dependencies: SendConnectionRequestDependencies,
): SendConnectionRequestService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async send(command: SendConnectionRequestCommand): Promise<ConnectionRequest> {
      const createdAt = readClock();

      return dependencies.connectionRequests.send({
        requesterId: command.requesterId,
        slug: command.slug,
        createdAt,
        liveSince: liveRequestFloor(createdAt),
        rateWindowSince: rateWindowFloor(createdAt),
      });
    },
  };
}
