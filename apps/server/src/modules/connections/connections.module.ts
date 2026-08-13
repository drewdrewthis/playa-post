import type { DatabaseConnection } from '@playa-post/database';

import type { OutboxConsumer } from '../../entrypoints/outbox-drainer/outbox-consumer';

import { createAcceptInviteService } from './application/accept-invite.service';
import { createCreateInviteService } from './application/create-invite.service';
import { createDecideConnectionRequestService } from './application/decide-connection-request.service';
import { createEnsurePersonalLinkService } from './application/ensure-personal-link.service';
import { createGetConnectionQuery } from './application/get-connection.query';
import { createListConnectionRequestsQuery } from './application/list-connection-requests.query';
import { createOpenInviteService } from './application/open-invite.service';
import { createOpenPersonalLinkQuery } from './application/open-personal-link.query';
import { createRotatePersonalLinkService } from './application/rotate-personal-link.service';
import { createSendConnectionRequestService } from './application/send-connection-request.service';
import { createSetConnectionTrustService } from './application/set-connection-trust.service';
import { createConnectIntroducedPairHandler } from './persistence/postgres-connect-introduced-pair.handler';
import { createPostgresConnectionRequestRepository } from './persistence/postgres-connection-request.repository';
import { createPostgresConnectionTrustRepository } from './persistence/postgres-connection-trust.repository';
import { createPostgresConnectionRepository } from './persistence/postgres-connection.repository';
import { createPostgresInvitationRepository } from './persistence/postgres-invitation.repository';
import { createPostgresPersonalLinkRepository } from './persistence/postgres-personal-link.repository';
import { createConnectionsRouter, type ConnectionsRouter } from './transport/connections.router';

/** What the composition root has to hand this module. */
export interface ConnectionsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount, and one outbox consumer. */
export interface ConnectionsModule {
  readonly router: ConnectionsRouter;
  /**
   * The `IntroAccepted` consumer, for the outbox drainer to route to (issue #166).
   *
   * Leaves the module because a consumer is useless until something delivers to it, and
   * the drainer is an entrypoint rather than a module — it cannot reach in, so the
   * subscription has to be handed out here. It is the module's second public surface and
   * still not a repository: what leaves is a handler that writes, never a way to read
   * `app.connection_trust` (see this factory's note below).
   *
   * ⚠ **Registering it is not optional decoration.** It is the whole of "accepting an
   * introduction connects you" (decision D12), so an unregistered consumer does not make
   * the connection late — it means the connection never forms, and nothing errors.
   * `composition/container-notification-wiring.integration.test.ts` holds the line.
   */
  readonly connectIntroducedPair: OutboxConsumer;
}

/**
 * Wire the connections module.
 *
 * **This file is the module's only wiring point, and that is what keeps the boundary
 * rules satisfiable.** `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers has to build the
 * repositories and inject them — that somebody is here. Nothing above
 * `modules/connections/` learns that `ConnectionRepository` has a Postgres
 * implementation.
 *
 * ⚠ **No repository leaves this module, and `app.connection_trust` is the reason to keep
 * it that way.** Identity exports its `ActorResolver` because every module needs "who is
 * this"; a trust repository exported the same way would be a second call site for a value
 * ADR-0002 B6 says never leaves its owner. A consumer that needs to know two people are
 * connected composes `app.visible_people` — the one authorized-people definition
 * (ADR-0002 §6) — rather than reaching in here.
 *
 * {@link ConnectionsModule.connectIntroducedPair} is not an exception to that. It goes
 * out to the drainer, which hands it events and reads nothing back; `modules/intros`
 * never learns this module exists, because the seam between them is a published event
 * (decision D12) rather than an injected service. That is the direction that keeps "one
 * module may not create another's rows" true while still letting an accepted introduction
 * make a connection.
 *
 * ⚠ **This module now owns all three ways a connection can form** (issue #206): a spent
 * invite (`postgres-connection.repository.ts`), an accepted introduction delivered as an
 * `IntroAccepted` event ({@link ConnectionsModule.connectIntroducedPair}), and an accepted
 * personal-link request (`postgres-connection-request.repository.ts`). Only the middle one
 * needs an event, and the reason is a module boundary rather than a policy about
 * asynchrony: `modules/intros` cannot write `app.connections`, and this module can. A
 * future path that lives here should be transactional; one that starts elsewhere should
 * publish.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure, so the whole
 * graph can be built before the database is reachable.
 */
export function createConnectionsModule(
  dependencies: ConnectionsModuleDependencies,
): ConnectionsModule {
  const { database } = dependencies;
  const invitations = createPostgresInvitationRepository({ database });
  const connections = createPostgresConnectionRepository({ database });
  const trust = createPostgresConnectionTrustRepository({ database });
  const personalLinks = createPostgresPersonalLinkRepository({ database });
  // One repository instance serves all four personal-link request operations, because it is
  // one connection pool over one pair of ports — `ConnectionRequestRepository` for the two
  // gated writes and `VisibleConnectionRequestsRepository` for the two §6a-projected reads.
  // Each service takes only the port it needs, so nothing here hands the send service a way
  // to read somebody's inbox.
  const connectionRequests = createPostgresConnectionRequestRepository({ database });

  return {
    router: createConnectionsRouter({
      createInvite: createCreateInviteService({ invitations }),
      openInvite: createOpenInviteService({ invitations }),
      acceptInvite: createAcceptInviteService({ invitations, connections }),
      setConnectionTrust: createSetConnectionTrustService({ connections, trust }),
      getConnection: createGetConnectionQuery({ connections, trust }),
      ensurePersonalLink: createEnsurePersonalLinkService({ personalLinks }),
      rotatePersonalLink: createRotatePersonalLinkService({ personalLinks }),
      openPersonalLink: createOpenPersonalLinkQuery({ links: connectionRequests }),
      sendConnectionRequest: createSendConnectionRequestService({ connectionRequests }),
      listConnectionRequests: createListConnectionRequestsQuery({ requests: connectionRequests }),
      decideConnectionRequest: createDecideConnectionRequestService({ connectionRequests }),
    }),
    connectIntroducedPair: createConnectIntroducedPairHandler({ database }),
  };
}
