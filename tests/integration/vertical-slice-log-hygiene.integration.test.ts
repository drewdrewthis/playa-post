import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS, type Logger } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import type { Configuration } from '../../apps/server/src/composition/config';
import { buildAppContainer, type AppContainer } from '../../apps/server/src/composition/container';
import { authenticateRequest } from '../../apps/server/src/shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../apps/server/src/shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../apps/server/src/shared/trpc/request-context';
import { createCallerFactory } from '../../apps/server/src/shared/trpc/trpc';

/**
 * `specs/features/vertical-slice-e2e.feature` › "The captured logs from a full slice
 * run contain no sensitive data" (M2-AC16). Cheapest honest shape for this evidence
 * clause: drive the real slice through the **real composition root** and a real
 * Postgres (exactly what every other `*.integration.test.ts` in this repo does), with
 * the container's own logger — same `createLogger` factory, same field allowlist
 * `apps/server/src/composition/container.ts` uses — pointed at an in-memory capturing
 * destination instead of stdout. Not a fabricated log fixture: every line this test
 * greps is a line the real logger actually emitted while the real router actually ran.
 *
 * ⚠ **`buildAppContainer`, not eight hand-wired module factories.** Three of the eight
 * modules cannot be built from `{ database }` alone — `notifications` needs the graph's
 * §6a projection and a push transport, `moderation` needs `bulletins`' authorized read,
 * and `sync` needs the mutation-handler and actorship registries that are *assembled by
 * the composition root* and exported from nowhere else. Reconstructing those here would
 * be a second copy of composition, and a second copy is the one that drifts: the
 * mutation registry this test exercised would stop being the one production serves.
 * `tests/e2e/global-setup.ts` boots the same way, for the same reason.
 *
 * Lives at `tests/integration/` rather than under any one module's `tests/`: this
 * scenario is not owned by identity, connections, graph, or bulletins — it is L5's, and
 * it exercises all eight. `vitest.config.ts`'s `integration` project includes this
 * location by glob.
 */
describe('The captured logs from a full slice run contain no sensitive data (vertical-slice-e2e.feature, M2-AC16)', () => {
  let testDatabase: PostgresTestDatabase;
  let container: AppContainer;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'log_hygiene_app_rw_password'`);

    const configuration: Configuration = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
      databaseUrl: withRole(
        testDatabase.connectionString,
        'app_rw',
        'log_hygiene_app_rw_password',
      ),
      // Never fetched: every caller below is built with the verifier under `dependencies`,
      // which reads the locally generated key pair. The container still needs the value
      // to build its own, and building it opens no socket.
      supabaseUrl: 'http://127.0.0.1:1/unused-by-this-suite',
    };

    container = buildAppContainer(configuration);
    signingKey = await generateSupabaseSigningKeyPair();
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await container?.dispose();
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

    const createCaller = createCallerFactory(container.router);

    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver: container.actorResolver,
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
    // 1. User A signs in / User B signs in (onboarding stands in for "already signed
    //    in and onboarded", same as every other integration suite's seeding step).
    //
    // ⚠ **Onboarding runs on its own caller, and the flow below gets fresh ones.**
    //    `RequestContext.authentication()` memoises its outcome for the life of the
    //    context — deliberately, because one HTTP request is one context and resolving
    //    the actor twice per request would mean two `app.users` reads. Onboarding is a
    //    `signedInProcedure`, which *accepts* `not-onboarded` and therefore caches
    //    exactly that; every later `authenticatedProcedure` call sharing that context
    //    replays the stale outcome and fails `ONBOARDING_REQUIRED`. A caller per phase
    //    is what production already does — onboarding genuinely is a different request
    //    from everything that follows it.
    await callerFor(tokenA).identity.completeOnboarding({
      handle: 'dusty_log_hygiene_a',
      displayName: emailAddressCanary,
    });
    const userB = await callerFor(tokenB).identity.completeOnboarding({
      handle: 'dusty_log_hygiene_b',
      displayName: 'User B',
    });

    const callerA = callerFor(tokenA);
    const callerB = callerFor(tokenB);

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
    //    `views.notifyMe.update`, not `notifications.*`: `app.notify_me_queries` is
    //    `modules/views`' table and its procedure lives with it (ADR-0007).
    await callerB.views.notifyMe.update({ sourceText: 'type:request' });

    // 10. User B dismisses or privately reports the bulletin.
    await callerB.moderation.dismiss({ bulletinId: bulletin.id });

    // 11. User A archives the bulletin, and one mutation replays from offline state.
    await callerA.bulletins.archive({ bulletinId: bulletin.id });
    await callerA.sync.submitMutations({
      mutations: [
        {
          mutationId: randomUUID(),
          mutationType: 'bulletin.archive',
          clientCreatedAt: new Date().toISOString(),
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
