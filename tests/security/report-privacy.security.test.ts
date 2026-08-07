import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import type { Configuration } from '../../apps/server/src/composition/config';
import {
  buildAppContainer,
  type AppContainer,
} from '../../apps/server/src/composition/container';
import { authenticateRequest } from '../../apps/server/src/shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../apps/server/src/shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../apps/server/src/shared/trpc/request-context';
import { createCallerFactory } from '../../apps/server/src/shared/trpc/trpc';

/**
 * **B9** — report privacy (M2-AC10).
 *
 * *"The reported author's every read path — bulletin, notifications, audit, API,
 * operator-mediated surfaces — contains no reporter identity."*
 *
 * The check is a **deep search of the serialized response**, not a field-name
 * assertion: a leak that matters is a value appearing anywhere at any nesting depth,
 * and `expect(response.reporterId).toBeUndefined()` only proves that one spelling of
 * the mistake was not made.
 *
 * ⚠ `graph.list` is deliberately **not** in the checked set. The reporter is the
 * author's connection by construction — that is the only way they could see the
 * bulletin to report it — so their identity is legitimately on the author's graph and
 * asserting its absence there would assert something false. B9 is about the *report*
 * not being the reason an identity is reachable; the bulletin read paths are where
 * that would show up, and they are what is checked.
 *
 * Notifications and operator surfaces are named in the row's assertion and have no
 * read procedure in M2 (no notifications reader, no operator entrypoint — B15 is M5),
 * so there is no such response to search yet. Their coverage arrives with those
 * surfaces; what exists today is asserted here in full.
 */
describe('B9 — a reported author cannot reach the reporter (M2-AC10)', () => {
  let testDatabase: PostgresTestDatabase;
  let container: AppContainer;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password 'report_privacy_app_rw_password'`,
    );

    const configuration: Configuration = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
      databaseUrl: withRole(
        testDatabase.connectionString,
        'app_rw',
        'report_privacy_app_rw_password',
      ),
      // Never fetched: every caller is built with the locally generated verifier below.
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

  it('leaves no reporter identity in any bulletin read path the author can reach', async () => {
    const createCaller = createCallerFactory(container.router);
    const logger = createLogger({
      level: 'silent',
      name: 'report-privacy',
      allowedFields: [...DEFAULT_ALLOWED_LOG_FIELDS, 'code'],
    });
    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver: container.actorResolver,
    };

    // ⚠ A caller per phase. `RequestContext.authentication()` memoises its outcome for
    // the life of the context (one HTTP request is one context), and onboarding is a
    // `signedInProcedure` that accepts — and therefore caches — `not-onboarded`. Reusing
    // the onboarding caller for the flow below replays that stale outcome and every
    // `authenticatedProcedure` call fails `ONBOARDING_REQUIRED`.
    const callerFor = (token: string): ReturnType<typeof createCaller> =>
      createCaller(contextFor(`Bearer ${token}`, dependencies, logger));

    const authorToken = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: randomUUID(),
    });
    const reporterToken = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: randomUUID(),
    });

    await callerFor(authorToken).identity.completeOnboarding({
      handle: 'b9_author',
      displayName: 'Reported Author',
    });
    const reporterUser = await callerFor(reporterToken).identity.completeOnboarding({
      handle: 'b9_reporter',
      displayName: 'Quiet Reporter',
    });

    const author = callerFor(authorToken);
    const reporter = callerFor(reporterToken);

    const invite = await author.connections.invitations.create();
    await reporter.connections.connection.accept({ token: invite.token });

    const bulletin = await author.bulletins.create({
      type: 'request',
      title: 'Need a ride to the airport',
      body: 'Leaving Sunday morning.',
    });

    const reportResponse = await reporter.moderation.report({ bulletinId: bulletin.id });

    // Every identifying string the reporter has. All three, because a leak that ships
    // the handle instead of the id is the same leak.
    const reporterIdentifiers = [reporterUser.userId, reporterUser.handle, 'Quiet Reporter'];

    const authorReadPaths: ReadonlyArray<readonly [string, unknown]> = [
      ['bulletins.getById', await author.bulletins.getById({ bulletinId: bulletin.id })],
      ['bulletins.listMine', await author.bulletins.listMine()],
      ['bulletins.board', await author.bulletins.board({})],
      ['moderation.report (the reporter’s own response)', reportResponse],
    ];

    for (const [label, response] of authorReadPaths) {
      const serialized = JSON.stringify(response);

      for (const identifier of reporterIdentifiers) {
        expect(
          serialized,
          `${label} carried the reporter's identity (${JSON.stringify(identifier)})`,
        ).not.toContain(identifier);
      }
    }
  });

  it('searches something — a scan of an empty response proves nothing', async () => {
    // The control of the control: if the read paths above ever came back empty (a
    // changed visibility rule, a broken seed), every `not.toContain` would pass while
    // proving nothing. This asserts the author can see their own bulletin at all.
    const createCaller = createCallerFactory(container.router);
    const logger = createLogger({
      level: 'silent',
      name: 'report-privacy',
      allowedFields: [...DEFAULT_ALLOWED_LOG_FIELDS, 'code'],
    });
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: randomUUID(),
    });
    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver: container.actorResolver,
    };
    // A caller per phase, for the reason given in the test above.
    const callerFor = (): ReturnType<typeof createCaller> =>
      createCaller(contextFor(`Bearer ${token}`, dependencies, logger));

    await callerFor().identity.completeOnboarding({ handle: 'b9_solo', displayName: 'Solo' });

    const author = callerFor();
    await author.bulletins.create({ type: 'request', title: 'A title', body: 'A body' });

    expect(await author.bulletins.listMine()).not.toHaveLength(0);
  });
});

/** Mirrors `bulletin-request-lifecycle.integration.test.ts`'s helper of the same name. */
function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
  logger: RequestContext['logger'],
): RequestContext {
  let outcome: ReturnType<typeof authenticateRequest> | undefined;
  return {
    correlationId: `report-privacy-${randomUUID()}`,
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
