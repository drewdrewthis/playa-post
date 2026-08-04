import { createRemoteJWKSet } from 'jose';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS, type Logger } from '@playa-post/observability';

import type { AccessTokenVerifier } from '../shared/auth/access-token-verifier';
import type { ActorResolver } from '../shared/auth/actor-resolver';
import { createNoOnboardedUsersResolver } from '../shared/auth/no-onboarded-users.resolver';
import { createSupabaseJwtVerifier } from '../shared/auth/supabase-jwt-verifier';
import { createAppRouter, type AppRouter } from '../shared/trpc/app.router';

import type { Configuration } from './config';
import { supabaseJwksUrl } from './supabase-jwks-url';

/**
 * The singleton-scoped object graph: everything built once per process and shared by
 * every request.
 *
 * A plain typed object, not a container library. ADR-0003 rejects Awilix, tsyringe,
 * and Nest for v1 — once `container.resolve(...)` is banned from business code
 * (addendum §12), a container's remaining job is wiring plus two lifetimes, and the
 * compiler already proves the wiring is complete and correctly typed. Revisit when
 * `registrations.ts` passes ~300 lines, which is ADR-0003's own trigger.
 *
 * ⚠ **Only `entrypoints/**` and `composition/**` may import this file** (ADR-0003:41),
 * enforced by the `no-container-outside-composition` rule in `.dependency-cruiser.cjs`
 * with a deliberately-violating fixture. A module that imports the container is a
 * service locator with extra steps; take dependencies through your module factory.
 */
export interface AppContainer {
  /** ⚠ Carries secrets. Never log it, never return it, never put it in a span. */
  readonly configuration: Configuration;
  /** Process-wide logger. Per-request children are bound in `buildRequestScope`. */
  readonly logger: Logger;
  /** Pooled handle connecting as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  readonly accessTokenVerifier: AccessTokenVerifier;
  readonly actorResolver: ActorResolver;
  /** The assembled tRPC router this process serves. */
  readonly router: AppRouter;
  /**
   * Release every long-lived resource. Idempotent is not promised — call it once,
   * from the entrypoint's shutdown path.
   */
  dispose(): Promise<void>;
}

/**
 * Build the application's object graph from validated configuration.
 *
 * **Touches no socket.** The `pg` pool connects lazily, `createRemoteJWKSet` returns a
 * resolver that fetches nothing until it is first asked for a key, and the router is a
 * pure data structure — so this can be called before the database or Supabase is
 * reachable, and a unit test can build the whole graph without infrastructure. It is
 * also why `main.ts` can build the container, register signal handlers, and only then
 * start listening.
 *
 * Everything it constructs is stateless or pooled; nothing here is per-request. The
 * actor, correlation ID, and request logger come from `buildRequestScope`
 * (addendum §12).
 *
 * @param configuration - Already validated by `loadServerConfiguration`. This function
 *   never reads `process.env` — `composition/config.ts` is the only place that may.
 *
 * @example
 * ```ts
 * const container = buildAppContainer(loadServerConfiguration());
 * try {
 *   await createHttpServer(container).listen({ host, port });
 * } finally {
 *   await container.dispose();
 * }
 * ```
 */
export function buildAppContainer(configuration: Configuration): AppContainer {
  const logger = createLogger({
    level: configuration.logLevel,
    name: 'playa-post-server',
    // `code` is the one field this runtime adds to the default allowlist: a failed
    // procedure logs its stable error code (`UNAUTHORIZED`, `BULLETIN_GONE`), which is
    // a fixed vocabulary and can never carry user content. The error *message* is
    // deliberately still dropped — see `http-server.ts`'s `onError`.
    allowedFields: [...DEFAULT_ALLOWED_LOG_FIELDS, 'code'],
  });
  const database = createDatabaseConnection({ connectionString: configuration.databaseUrl });

  return {
    configuration,
    logger,
    database,
    accessTokenVerifier: createSupabaseJwtVerifier({
      // One key source per process, deliberately. `createRemoteJWKSet` holds the fetched
      // key set in its own closure and refuses to re-fetch inside a cooldown window, so
      // rebuilding it per request would discard the cache and turn Supabase's JWKS
      // endpoint into a hard dependency of every authenticated call — an availability
      // coupling, and abusive traffic, for no benefit. Key rotation still lands: an
      // unrecognised `kid` is what triggers a refresh.
      keySource: createRemoteJWKSet(supabaseJwksUrl(configuration.supabaseUrl)),
    }),
    // Replaced in lane L1 by modules/identity's ResolveActorQuery, which reads
    // app.users. Until that table exists, "nobody is onboarded" is the truth, not a
    // stub — see the resolver's own doc comment.
    actorResolver: createNoOnboardedUsersResolver(),
    router: createAppRouter(),
    dispose: () => database.destroy(),
  };
}
