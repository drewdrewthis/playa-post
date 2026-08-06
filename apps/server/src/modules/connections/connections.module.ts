import type { DatabaseConnection } from '@playa-post/database';

import { createAcceptInviteService } from './application/accept-invite.service';
import { createCreateInviteService } from './application/create-invite.service';
import { createGetConnectionQuery } from './application/get-connection.query';
import { createOpenInviteService } from './application/open-invite.service';
import { createSetConnectionTrustService } from './application/set-connection-trust.service';
import { createPostgresConnectionTrustRepository } from './persistence/postgres-connection-trust.repository';
import { createPostgresConnectionRepository } from './persistence/postgres-connection.repository';
import { createPostgresInvitationRepository } from './persistence/postgres-invitation.repository';
import { createConnectionsRouter, type ConnectionsRouter } from './transport/connections.router';

/** What the composition root has to hand this module. */
export interface ConnectionsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount. */
export interface ConnectionsModule {
  readonly router: ConnectionsRouter;
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
 * ⚠ Nothing leaves this module but the router, and `app.connection_trust` is the
 * reason to keep it that way. Identity exports its `ActorResolver` because every
 * module needs "who is this"; a trust repository exported the same way would be a
 * second call site for a value ADR-0002 B6 says never leaves its owner. A future
 * consumer that needs to know two people are connected should compose
 * `app.visible_people` — the one authorized-people definition (ADR-0002 §6) — rather
 * than reach in here.
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

  return {
    router: createConnectionsRouter({
      createInvite: createCreateInviteService({ invitations }),
      openInvite: createOpenInviteService({ invitations }),
      acceptInvite: createAcceptInviteService({ invitations, connections }),
      setConnectionTrust: createSetConnectionTrustService({ connections, trust }),
      getConnection: createGetConnectionQuery({ connections, trust }),
    }),
  };
}
