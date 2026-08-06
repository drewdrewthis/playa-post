import type { ConnectionTrustRepository } from '../domain/connection-trust.repository';
import { NotConnectedError } from '../domain/connection.errors';
import type { ConnectionRepository } from '../domain/connection.repository';

/** What reading a connection is given. `actorId` comes from the resolved `Actor`. */
export interface GetConnectionCommand {
  readonly actorId: string;
  readonly otherUserId: string;
}

/**
 * One connection, as its own party sees it.
 *
 * **Two fields, and the smallest payload that answers the question is the point**
 * (the same discipline `modules/identity/transport/user.presenter.ts` states). This
 * response is the primary surface M2-AC3 asserts trust privacy across, so every extra
 * field is another thing that has to be re-justified against B6 — and the caller
 * already supplied the other person's ID to get here, so echoing it back buys nothing.
 *
 * Identity fields are absent for a stronger reason: rendering the other person is the
 * graph module's projection to do, through `app.visible_people`'s disclosure level
 * (ADR-0002 §6a). A connection read that joined `app.users` would be exactly the
 * "author card built by joining directly" that §6a forbids.
 */
export interface ConnectionView {
  /** `accepted` — the only state M2 has. */
  readonly status: string;
  /**
   * The **actor's own** directional trust toward the other person.
   *
   * `null` means unset, and unset is not `0` (ADR-0004:70-71, M2-AC4). It is never the
   * other party's value: the repository is keyed on `ownerId` first and has no method
   * that could return somebody else's opinion.
   */
  readonly trust: number | null;
}

export interface GetConnectionQuery {
  get(command: GetConnectionCommand): Promise<ConnectionView>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface GetConnectionDependencies {
  readonly connections: ConnectionRepository;
  readonly trust: ConnectionTrustRepository;
}

/**
 * Read one connection the actor is party to.
 *
 * Membership is the authorization rule, and it is checked by *asking for the actor's
 * own connection* rather than by fetching a connection and then testing it — a lookup
 * that cannot express "somebody else's connection" cannot leak one. A third party gets
 * `NOT_CONNECTED`, identical to the answer for two people who genuinely are not
 * connected, so the error discloses nothing about a relationship between others
 * (ADR-0002 §10, B6).
 */
export function createGetConnectionQuery(
  dependencies: GetConnectionDependencies,
): GetConnectionQuery {
  return {
    async get(command: GetConnectionCommand): Promise<ConnectionView> {
      const connection = await dependencies.connections.findBetween(
        command.actorId,
        command.otherUserId,
      );

      if (connection === null) {
        throw new NotConnectedError();
      }

      return {
        status: connection.status,
        trust: await dependencies.trust.findOwn(command.actorId, command.otherUserId),
      };
    },
  };
}
