import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS, type Logger } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import { createBulletinsModule } from '../src/modules/bulletins/bulletins.module';
import { createConnectionsModule } from '../src/modules/connections/connections.module';
import { createGraphModule } from '../src/modules/graph/graph.module';
import { createIdentityModule } from '../src/modules/identity/identity.module';
// None of these three exist yet. `git log` on this branch's base shows L1 (identity),
// L2 (connections, graph), L3a (bulletins, views) and L3b-infra (audit, outbox) merged
// — L3b-notify (notifications/Notify Me) and L4 (moderation's dismiss/report, sync's
// offline mutation replay) have not. That is the correct, legible reason this file
// cannot collect today: M2-AC16's evidence clause is "the full e2e flow", and there is
// no full flow — steps 9, 10, and 11 of the eleven-step slice have no application code
// behind them yet. Same seam, same convention as
// `apps/server/src/modules/bulletins/tests/integration/bulletin-request-lifecycle.
// integration.test.ts` importing services ahead of L3a landing.
import { createModerationModule } from '../src/modules/moderation/moderation.module';
import { createNotificationsModule } from '../src/modules/notifications/notifications.module';
import { createSyncModule } from '../src/modules/sync/sync.module';
import { authenticateRequest } from '../src/shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../src/shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../src/shared/trpc/request-context';
import { createCallerFactory, router } from '../src/shared/trpc/trpc';

/**
 * `specs/features/vertical-slice-e2e.feature` › "The captured logs from a full slice
 * run contain no sensitive data" (M2-AC16). Cheapest honest shape for this evidence
 * clause: drive the real slice through real module factories and a real Postgres
 * (exactly what every other `*.integration.test.ts` in this repo does), with the
 * container's own logger — same `createLogger` factory, same field allowlist
 * `apps/server/src/composition/container.ts` uses — pointed at an in-memory capturing
 * destination instead of stdout. Not a fabricated log fixture: every line this test
 * greps is a line the real logger actually emitted while the real router actually
 * ran.
 *
 * Lives at `apps/server/tests/` rather than under any one module's `tests/`: this
 * scenario is not owned by identity, connections, graph, or bulletins — it is L5's,
 * and it exercises all of them plus the three modules still missing (see the import
 * comment above). `vitest.config.ts`'s `integration` project includes
 * `apps/**\/*.integration.test.ts` at any depth, so no config change is needed to run
 * it once the coder lands the missing modules.
 */
describe('The captured logs from a full slice run contain no sensitive data (vertical-slice-e2e.feature, M2-AC16)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'log_hygiene_app_rw_password'`);
    database = createDatabaseConnection({
      connectionString: withRole(testDatabase.connectionString, 'app_rw', 'log_hygiene_app_rw_password'),
    });
    signingKey = await generateSupabaseSigningKeyPair();
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  it('finds zero matches for the bulletin body, the invite token, a JWT, and an email address', async () => {
    const destination = new CapturingDestination();
    const logger = createLogger(
      {
        level: 'info',
        name: 'vertical-slice-log-hygiene',
        // The exact allowlist `buildAppContainer` uses (`composition/container.ts`) —
        // this test proves the allowlist holds under a real run, so it must be the
        // real allowlist, not a narrower one that would pass for the wrong reason.
        allowedFields: [...DEFAULT_ALLOWED_LOG_FIELDS, 'code'],
      },
      destination,
    );

    const identity = createIdentityModule({ database });
    const connections = createConnectionsModule({ database });
    const graph = createGraphModule({ database });
    const bulletins = createBulletinsModule({ database });
    const notifications = createNotificationsModule({ database });
    const moderation = createModerationModule({ database });
    const sync = createSyncModule({ database });

    const appRouter = router({
      identity: identity.router,
      connections: connections.router,
      graph: graph.router,
      bulletins: bulletins.router,
      notifications: notifications.router,
      moderation: moderation.router,
      sync: sync.router,
    });
    const createCaller = createCallerFactory(appRouter);

    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver: identity.actorResolver,
    };
    const callerFor = (bearerToken: string): ReturnType<typeof createCaller> =>
      createCaller(contextFor(`Bearer ${bearerToken}`, dependencies, logger));

    // The four canaries M2-AC16 greps for. `emailAddressCanary` lands in a display
    // name rather than a dedicated email field: `modules/identity/domain/user.ts`
    // deliberately has none (ADR-0008 rule 2 — "there is no email here"), so a display
    // name a user typed an email address into is the one place in this system's real
    // schema where the canary is genuine rather than contrived.
    const emailAddressCanary = 'dusty.canary@example-community.test';
    const bulletinBodyCanary = `CANARY_BULLETIN_BODY_${randomUUID()}`;

    const tokenA = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: randomUUID(),
    });
    const tokenB = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: randomUUID(),
    });
    const callerA = callerFor(tokenA);
    const callerB = callerFor(tokenB);

    // 1. User A signs in / User B signs in (onboarding stands in for "already signed
    //    in and onboarded", same as every other integration suite's seeding step).
    await callerA.identity.completeOnboarding({
      handle: 'dusty_log_hygiene_a',
      displayName: emailAddressCanary,
    });
    const userB = await callerB.identity.completeOnboarding({
      handle: 'dusty_log_hygiene_b',
      displayName: 'User B',
    });

    // 2. User A creates an invite.
    const invite = await callerA.connections.invitations.create();

    // 3. User B opens the invite.
    await callerB.connections.invitations.open({ token: invite.token });

    // 4. User B accepts the invite.
    await callerB.connections.connection.accept({ token: invite.token });

    // 5. User A assigns private directional trust to user B.
    await callerA.connections.trust.set({ subjectUserId: userB.userId, trust: 85 });

    // 6. The graph renders the accepted connection for both users.
    await callerA.graph.list();
    await callerB.graph.list();

    // 7. User A creates a Request bulletin.
    const bulletin = await callerA.bulletins.create({
      type: 'request',
      title: 'Need a ride to the airport',
      body: bulletinBodyCanary,
    });

    // 8. User B, an eligible viewer, sees the bulletin.
    await callerB.bulletins.board({});

    // 9. Notify Me produces a grouped notification for a matching viewer.
    await callerB.notifications.notifyMe.update({ query: 'type:request' });

    // 10. User B dismisses or privately reports the bulletin.
    await callerB.moderation.dismiss({ bulletinId: bulletin.id });

    // 11. User A archives the bulletin, and one mutation replays from offline state.
    await callerA.bulletins.archive({ bulletinId: bulletin.id });
    await callerA.sync.submitMutations({
      mutations: [
        {
          clientMutationId: randomUUID(),
          type: 'bulletin.archive',
          payload: { bulletinId: bulletin.id },
        },
      ],
    });

    const capturedLogs = destination.text();
    const canaries: ReadonlyArray<readonly [label: string, value: string]> = [
      ['the bulletin body', bulletinBodyCanary],
      ['the invite token', invite.token],
      ['a JWT', tokenA],
      ['an email address', emailAddressCanary],
    ];

    for (const [label, value] of canaries) {
      expect(
        capturedLogs,
        `expected zero captured log lines containing ${label} (${JSON.stringify(value)})`,
      ).not.toContain(value);
    }
  });
});

/** Collects every line the logger writes, for the test to grep afterward. */
class CapturingDestination extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Mirrors `bulletin-request-lifecycle.integration.test.ts`'s helper of the same name. */
function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
  logger: Logger,
): RequestContext {
  let outcome: ReturnType<typeof authenticateRequest> | undefined;
  return {
    correlationId: `log-hygiene-${randomUUID()}`,
    logger,
    authentication: () => (outcome ??= authenticateRequest(authorizationHeader, dependencies)),
  };
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function withRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
