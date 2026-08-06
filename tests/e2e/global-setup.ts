import { randomUUID } from 'node:crypto';

import type { FullConfig } from '@playwright/test';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { Configuration } from '../../apps/server/src/composition/config';
import { buildAppContainer, type AppContainer } from '../../apps/server/src/composition/container';
import { buildRequestScope } from '../../apps/server/src/composition/request-scope';
import { createHttpServer } from '../../apps/server/src/entrypoints/http/http-server';
import { createCallerFactory } from '../../apps/server/src/shared/trpc/trpc';

import { API_PORT } from './support/e2e-ports';
import { startMockSupabaseJwtIssuer, type MockSupabaseJwtIssuer } from './support/mock-supabase-jwt-issuer';

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
 * ⚠ **Not wired into this file: `modules/moderation` and `modules/sync`.** Neither has
 * merged into this branch's base (`git log` shows L1–L3a and L3b-infra only) — steps
 * 10 and 11 of the eleven-step flow have no application code to call yet, and that is
 * the correct, legible reason the spec's later steps cannot pass today. Extending this
 * file to wire them in is the coder's job once those modules exist, not a hole in this
 * harness.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const testDatabase: PostgresTestDatabase = await startPostgresTestDatabase();
  await testDatabase.client.query(
    `alter role app_rw with password 'e2e_app_rw_in_a_throwaway_container'`,
  );

  const jwtIssuer: MockSupabaseJwtIssuer = await startMockSupabaseJwtIssuer();

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
  };

  const container: AppContainer = buildAppContainer(configuration);
  const httpServer = createHttpServer(container);
  await httpServer.listen({ host: configuration.host, port: configuration.port });

  const userA = await onboard(container, jwtIssuer, 'e2e_user_a', 'User A');
  const userB = await onboard(container, jwtIssuer, 'e2e_user_b', 'User B');

  process.env['E2E_API_BASE_URL'] = `http://127.0.0.1:${API_PORT}`;
  process.env['E2E_USER_A_ACCESS_TOKEN'] = userA.accessToken;
  process.env['E2E_USER_B_ACCESS_TOKEN'] = userB.accessToken;
  process.env['E2E_USER_A_HANDLE'] = userA.handle;
  process.env['E2E_USER_B_HANDLE'] = userB.handle;

  return async function globalTeardown(): Promise<void> {
    await httpServer.close();
    await container.dispose();
    await jwtIssuer.stop();
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
  const caller = createCallerFactory(container.router)(
    buildRequestScope(container, { authorizationHeader: `Bearer ${accessToken}` }),
  );

  await caller.identity.completeOnboarding({ handle, displayName });

  return { authUserId, handle, accessToken };
}

function withRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
