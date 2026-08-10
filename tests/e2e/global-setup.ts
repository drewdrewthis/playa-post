import { randomUUID } from 'node:crypto';

import type { FullConfig } from '@playwright/test';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { Configuration } from '../../apps/server/src/composition/config';
import { buildAppContainer, type AppContainer } from '../../apps/server/src/composition/container';
import { buildRequestScope } from '../../apps/server/src/composition/request-scope';
import { createHttpServer } from '../../apps/server/src/entrypoints/http/http-server';
import { startNotificationFlushPoller } from '../../apps/server/src/entrypoints/notification-flush/start-notification-flush-poller';
import { startOutboxDrainerPoller } from '../../apps/server/src/entrypoints/outbox-drainer/start-outbox-drainer-poller';
import { createCallerFactory } from '../../apps/server/src/shared/trpc/trpc';

import { API_PORT } from './support/e2e-ports';
import { startMockSupabaseJwtIssuer, type MockSupabaseJwtIssuer } from './support/mock-supabase-jwt-issuer';
import { startMockWebPushTransport } from './support/mock-web-push-transport';

/**
 * How often the e2e server's grouping-window flush polls. Production's poller runs
 * every 10s; here it is 1s so step 9's wait is dominated by the 60-second grouping
 * window itself (M2-AC7, a domain constant the harness must not shorten), not by
 * poll latency stacked on top of it.
 */
const E2E_FLUSH_INTERVAL_MS = 1_000;

/**
 * Boots the real substrate `vertical-slice-e2e.spec.ts` drives the frontend against:
 * a real, migrated Postgres (Testcontainers, same image and same `supabase/migrations`
 * every integration test uses), the real Fastify + tRPC server built from the real
 * composition root (`buildAppContainer` — every wired module: identity, connections,
 * graph, bulletins), and the one mocked boundary the lane brief allows for
 * authentication, `startMockSupabaseJwtIssuer`.
 *
 * Runs once, in Playwright's main process, **before** any `webServer` entry starts
 * and before any worker process is spawned. Returned teardown function runs after
 * every test has finished. Two onboarded users' access tokens are written to
 * `process.env` here — Playwright inherits the main process's environment into every
 * worker it spawns, so this is the standard, documented way to hand a worker state
 * that was expensive to build once (minting a token is cheap; standing up the two
 * *onboarded* `app.users` rows behind it, through the real `identity.completeOnboarding`
 * procedure, is the part worth doing exactly once).
 *
 * ⚠ **`buildAppContainer` is the whole wiring, and that is deliberate.** Three of the
 * eight modules cannot be constructed from `{ database }` alone — `notifications` needs
 * the graph's §6a projection and a push transport, `moderation` needs `bulletins`'
 * authorized read, and `sync` needs the mutation-handler and actorship registries that
 * the composition root assembles and exports from nowhere else. Hand-wiring them here
 * would put a second copy of composition in the harness, and the second copy is the one
 * that drifts: the router this e2e drives would stop being the router production
 * serves. When a lane mounts a ninth module, this file needs no edit.
 *
 * **Step 9's environment is completed here, in three moves.** (a) The mock web-push
 * transport is injected through `buildAppContainer`'s composition-layer override seam
 * (issue #31, option 2), which is what makes `container.notificationFlush` non-null.
 * (b) User B is seeded with a Notify Me query (`type:request`) through the real
 * `views.notifyMe.update` procedure, so step 7's Request bulletin produces a
 * `NotifyMeMatched` row. (c) The same two scheduled loops production's `main.ts`
 * starts — the outbox drainer (which runs `EvaluateNotifyMeHandler`) and the
 * grouping-window flush — are started here on a 1-second interval, so the elapsed
 * window is actually flushed and `notifications.list` has receipts to read.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const testDatabase: PostgresTestDatabase = await startPostgresTestDatabase();
  await testDatabase.client.query(
    `alter role app_rw with password 'e2e_app_rw_in_a_throwaway_container'`,
  );

  const jwtIssuer: MockSupabaseJwtIssuer = await startMockSupabaseJwtIssuer();
  const webPush = await startMockWebPushTransport();

  const configuration: Configuration = {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: API_PORT,
    logLevel: 'silent',
    databaseUrl: withRole(
      testDatabase.connectionString,
      'app_rw',
      'e2e_app_rw_in_a_throwaway_container',
    ),
    supabaseUrl: jwtIssuer.baseUrl,
    // No VAPID keys, and none needed: the override below replaces the transport
    // outright, so this harness reaches a local HTTP recorder instead of a real push
    // service. Configuring keys here would sign requests nothing verifies.
    webPush: null,
  };

  const container: AppContainer = buildAppContainer(configuration, {
    pushTransport: webPush.transport,
  });
  const httpServer = createHttpServer(container);
  await httpServer.listen({ host: configuration.host, port: configuration.port });

  const userA = await onboard(container, jwtIssuer, 'e2e_user_a', 'User A');
  const userB = await onboard(container, jwtIssuer, 'e2e_user_b', 'User B');
  const userC = await onboard(container, jwtIssuer, 'e2e_user_c', 'User C');

  // The intro-request path (issue #89, AC27) needs a degree-2 pair, and a degree-2
  // pair needs two edges: A—B and B—C, giving A→C exactly two hops through B. Seeded
  // through the real invite procedures, like everything else here. Pre-connecting A—B
  // does not disturb `vertical-slice-e2e.spec.ts`'s in-browser accept of a fresh
  // token: `AcceptInviteService` resolves an already-connected pair to the existing
  // connection idempotently, so the banner still renders.
  await connect(container, userA, userB);
  await connect(container, userB, userC);

  // Step 9's precondition: without a saved query, `EvaluateNotifyMeHandler` matches
  // nothing and the notifications panel is legitimately empty. `type:request` matches
  // the Request bulletin step 7 creates. Seeded through the real procedure, like
  // onboarding above, so the row is exactly what a signed-in User B would have saved.
  await callerFor(container, userB.accessToken).views.notifyMe.update({
    sourceText: 'type:request',
  });

  if (container.notificationFlush === null) {
    throw new Error(
      'global-setup.ts: notificationFlush is null despite the injected mock transport — the container seam regressed',
    );
  }
  const flushPoller = startNotificationFlushPoller({
    flusher: container.notificationFlush,
    intervalMs: E2E_FLUSH_INTERVAL_MS,
  });
  // The other scheduled loop `main.ts` starts, for the same reason: without the
  // drainer, `BulletinCreated` is never consumed, `EvaluateNotifyMeHandler` never
  // writes a `NotifyMeMatched` row, and the flush above has nothing to deliver.
  const drainerPoller = startOutboxDrainerPoller({
    drainer: container.outboxDrainer,
    intervalMs: E2E_FLUSH_INTERVAL_MS,
  });

  process.env['E2E_API_BASE_URL'] = `http://127.0.0.1:${API_PORT}`;
  process.env['E2E_USER_A_ACCESS_TOKEN'] = userA.accessToken;
  process.env['E2E_USER_B_ACCESS_TOKEN'] = userB.accessToken;
  process.env['E2E_USER_C_ACCESS_TOKEN'] = userC.accessToken;
  process.env['E2E_USER_A_HANDLE'] = userA.handle;
  process.env['E2E_USER_B_HANDLE'] = userB.handle;
  process.env['E2E_USER_C_HANDLE'] = userC.handle;

  return async function globalTeardown(): Promise<void> {
    // Pollers first: `stop()` waits for any in-flight round, which writes through the
    // pool `container.dispose()` destroys.
    await drainerPoller.stop();
    await flushPoller.stop();
    await httpServer.close();
    await container.dispose();
    await jwtIssuer.stop();
    await webPush.stop();
    await testDatabase.stop();
  };
}

interface OnboardedTestUser {
  readonly authUserId: string;
  readonly handle: string;
  readonly accessToken: string;
}

/**
 * Onboards one test user through the real `identity.completeOnboarding` procedure —
 * not a direct `insert into app.users`, unlike most module-level integration tests'
 * `seedOnboardedUser` helpers. Steps 1–4 of the flow ("User A signs in" / "creates an
 * invite" / "User B opens" / "accepts") depend on both users already existing as
 * `app.users` rows with real handles by the time the browser drives sign-in, exactly
 * as they would after a real magic-link onboarding — the token minted here is what
 * lets the frontend skip past magic-link email delivery (undeliverable in a headless
 * run) while everything downstream of that token stays real.
 */
async function onboard(
  container: AppContainer,
  jwtIssuer: MockSupabaseJwtIssuer,
  handle: string,
  displayName: string,
): Promise<OnboardedTestUser> {
  const authUserId = randomUUID();
  const accessToken = await jwtIssuer.mintAccessToken(authUserId);

  await callerFor(container, accessToken).identity.completeOnboarding({ handle, displayName });

  return { authUserId, handle, accessToken };
}

/** Connects two onboarded users through the real invite procedures: mint, then spend. */
async function connect(
  container: AppContainer,
  inviter: OnboardedTestUser,
  accepter: OnboardedTestUser,
): Promise<void> {
  const invite = await callerFor(container, inviter.accessToken).connections.invitations.create();
  await callerFor(container, accepter.accessToken).connections.connection.accept({
    token: invite.token,
  });
}

/** A server-side tRPC caller acting as the bearer of `accessToken`. */
function callerFor(container: AppContainer, accessToken: string) {
  return createCallerFactory(container.router)(
    buildRequestScope(container, { authorizationHeader: `Bearer ${accessToken}` }),
  );
}

function withRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
