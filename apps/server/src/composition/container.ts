import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet } from 'jose';
import { z } from 'zod';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS, type Logger } from '@playa-post/observability';

import { createOutboxDrainer, type OutboxDrainer } from '../entrypoints/outbox-drainer/outbox-drainer';
import { createAuditModule } from '../modules/audit/audit.module';
import type { CreateBulletinService } from '../modules/bulletins/application/create-bulletin.service';
import type { FindVisibleBulletinAuthor } from '../modules/bulletins/application/find-visible-bulletin-author.query';
import { createBulletinsModule } from '../modules/bulletins/bulletins.module';
import { presentBulletin } from '../modules/bulletins/transport/bulletin.presenter';
import { createBulletinInput } from '../modules/bulletins/transport/create-bulletin.input';
import { createConnectionsModule } from '../modules/connections/connections.module';
import { createGraphModule } from '../modules/graph/graph.module';
import { createIdentityModule } from '../modules/identity/identity.module';
import {
  createHiddenBulletins,
  createModerationModule,
} from '../modules/moderation/moderation.module';
import type { SendGroupedPushHandler } from '../modules/notifications/application/send-grouped-push.handler';
import { isPushDeliveryConfigured, type PushTransport } from '../modules/notifications/domain/push-transport';
import { unconfiguredPushTransport } from '../modules/notifications/infrastructure/unconfigured-push.transport';
import { createNotificationsModule } from '../modules/notifications/notifications.module';
import type {
  MutationActorshipCheck,
  MutationActorshipCheckRegistry,
  MutationHandlerRegistry,
} from '../modules/sync/domain/mutation-handler';
import {
  MutationActorshipError,
  MutationPayloadInvalidError,
} from '../modules/sync/domain/sync.errors';
import { createSyncModule } from '../modules/sync/sync.module';
import { createViewsModule } from '../modules/views/views.module';
import type { AccessTokenVerifier } from '../shared/auth/access-token-verifier';
import type { ActorResolver } from '../shared/auth/actor-resolver';
import { createSupabaseJwtVerifier } from '../shared/auth/supabase-jwt-verifier';
import { createAppRouter, type AppRouter } from '../shared/trpc/app.router';

import type { Configuration } from './config';
import { toDrainerConsumer } from './outbox-consumer.adapter';
import { supabaseJwksUrl } from './supabase-jwks-url';

/**
 * The sync payload of every bulletin mutation that names an existing bulletin.
 *
 * Composition is where the mutation registry is assembled (ADR-0005), so composition is
 * where an envelope's opaque `payload` is narrowed: `modules/sync` may not know a
 * bulletin's shape, and `modules/bulletins` may not know an envelope's. This is the one
 * seam that is allowed to know both.
 */
const bulletinTargetPayload = z.object({ bulletinId: z.uuid() });

/**
 * Narrow an envelope payload, or refuse the envelope.
 *
 * A `MutationPayloadInvalidError` rather than a thrown parse failure, so a malformed
 * payload comes back as one refused envelope with a stable code instead of a 500 for
 * the whole batch (ADR-0005: "never batch-fatal").
 */
function bulletinTargetOf(mutationType: string, payload: unknown): string {
  const parsed = bulletinTargetPayload.safeParse(payload);

  if (!parsed.success) {
    throw new MutationPayloadInvalidError(mutationType);
  }

  return parsed.data.bulletinId;
}

/**
 * ADR-0005 precedence rule 1 for the bulletin mutations, as a pre-dispatch check.
 *
 * ⚠ **It composes `modules/bulletins`' authorized read**, so an actor's relationship to
 * a bulletin is decided by the same predicate `bulletins.getById` uses. Anything
 * cheaper here would be a second answer to "may this actor touch that bulletin",
 * reachable only through the offline path — which is precisely the write-path IDOR B13
 * measures.
 *
 * @param asAuthor - `true` for a mutation only the author may make (`bulletin.archive`);
 *   `false` for one any authorized viewer may make (`bulletin.report`,
 *   `bulletin.dismiss`). The service behind each still enforces its own rules — an
 *   author reporting their own bulletin is refused by
 *   `ReportBulletinService`, not here — because this gate answers *actorship*, which
 *   ADR-0005 requires to be settled before any handler runs.
 */
function requireBulletinActorship(
  findVisibleBulletin: FindVisibleBulletinAuthor,
  asAuthor: boolean,
): MutationActorshipCheck {
  return async ({ actorId, mutationType, payload }) => {
    const target = await findVisibleBulletin(actorId, bulletinTargetOf(mutationType, payload));

    if (target === null || (asAuthor && target.authorId !== actorId)) {
      throw new MutationActorshipError();
    }
  };
}

/**
 * The `MutationType → handler` registry — M2 wires exactly one replayable handler.
 *
 * `bulletin.create` needs no actorship check: the author is the acting actor, so there
 * is no subject for them to be unrelated to (see `create-bulletin.service.ts`). Its
 * result is `presentBulletin`'s, deliberately — a client must not be able to tell from
 * the payload whether its change went through the tRPC procedure or the offline queue.
 */
function mutationHandlers(createBulletin: CreateBulletinService): MutationHandlerRegistry {
  return {
    'bulletin.create': {
      async handle({ actorId, mutationType, payload }) {
        const parsed = createBulletinInput.safeParse(payload);

        if (!parsed.success) {
          throw new MutationPayloadInvalidError(mutationType);
        }

        return {
          result: presentBulletin(
            await createBulletin.create({
              // From the resolved actor, never from the payload (ADR-0002 §5a, B14) —
              // the one line in the offline path where impersonation would live.
              authorId: actorId,
              type: parsed.data.type,
              title: parsed.data.title,
              body: parsed.data.body,
            }),
          ),
        };
      },
    },
  };
}

/**
 * The `MutationType → pre-dispatch actorship check` registry.
 *
 * ⚠ **Incomplete, and the gap is named rather than hidden.** `connection.accept`,
 * `trust.set`, and `notifyMe.update` are M2 mutations with no entry here, so an
 * unrelated actor submitting one gets `UNSUPPORTED_MUTATION_TYPE` instead of
 * `MUTATION_ACTOR_UNAUTHORIZED` — the vacuous-B13 shape blocking finding B-2 warns
 * about. `modules/connections` exports no application interface to check against yet
 * and `notifyMe.update` does not exist until lane L3b-notify (lane-brief C13 already
 * records that join). Each owes an entry here as part of its own definition of done.
 */
function mutationActorshipChecks(
  findVisibleBulletin: FindVisibleBulletinAuthor,
): MutationActorshipCheckRegistry {
  return {
    'bulletin.archive': requireBulletinActorship(findVisibleBulletin, true),
    'bulletin.report': requireBulletinActorship(findVisibleBulletin, false),
    'bulletin.dismiss': requireBulletinActorship(findVisibleBulletin, false),
  };
}

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
   * `drainOnce()` claims and dispatches one round of `app.outbox_events`. Exposed
   * here, unstarted — this container never calls it. *When* it runs is
   * `entrypoints/outbox-drainer/start-outbox-drainer-poller.ts`'s job, started from
   * `entrypoints/http/main.ts` alongside the HTTP server (ADR-0006: in-process, no
   * separate service).
   */
  readonly outboxDrainer: OutboxDrainer;
  /**
   * `flush({ now })` delivers every notification grouping window that has elapsed
   * (M2.11), or **`null` when the wired push transport cannot deliver** — which is M2's
   * state, because no VAPID key pair is configured.
   *
   * Exposed unstarted for the same reason {@link outboxDrainer} is: *when* it runs is
   * `entrypoints/notification-flush/start-notification-flush-poller.ts`'s job. A second
   * scheduled task rather than a drainer consumer, because the 60-second window is a
   * decision about elapsed time and only a clock can make it — which is also why the
   * drainer is given `excludedEventTypes` so it never claims the rows this reads.
   *
   * ⚠ **`null` is the schedule-or-not decision, expressed in the type** rather than as
   * a boolean an entrypoint could read and ignore: there is no way to start a flush
   * loop that can only throw. `null` costs nothing — the drainer and
   * `EvaluateNotifyMeHandler` keep running, so matches accumulate as `pending` rows and
   * the first flush after a real transport lands delivers them.
   */
  readonly notificationFlush: SendGroupedPushHandler | null;
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
 * @param overrides - Composition-layer injection seam (issue #31, option 2). Today it
 *   carries exactly one thing: a `PushTransport` for a harness that needs the flush to
 *   be schedulable — the e2e's recording transport in `tests/e2e/global-setup.ts` is
 *   the one caller. Absent, the wiring is byte-identical to before the seam existed:
 *   `unconfiguredPushTransport`, so `notificationFlush` stays `null` until a real
 *   VAPID-configured adapter replaces that default here.
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
export function buildAppContainer(
  configuration: Configuration,
  overrides?: { readonly pushTransport?: PushTransport },
): AppContainer {
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
  // Identity is built before the router because it supplies two things at once: the
  // procedures to mount and the `ActorResolver` every other module's authorization
  // depends on (ADR-0008 rule 8).
  const identity = createIdentityModule({ database });
  const connections = createConnectionsModule({ database });
  // Graph is built before bulletins because it is the one other modules consume: its
  // `visiblePeople` projection is the single §6a person read (lane-brief C8), and a
  // module that needs a person card takes it from here rather than joining `app.users`
  // itself.
  const graph = createGraphModule({ database });
  // Bulletins consumes that same rule one layer lower — `app.visible_bulletins`
  // composes `app.visible_people` in SQL — so it needs nothing from `graph` here, and
  // the wiring order between the two carries no meaning.
  //
  // Moderation and bulletins do need each other, and this is the order that unties it:
  // the board exclusion is built first, on its own (`createHiddenBulletins`), so
  // bulletins can be built complete, so moderation can be handed the authorized read it
  // needs to decide whether an actor may moderate a bulletin at all. Nothing here is
  // lazily captured; every line only names what is already built.
  const hiddenBulletins = createHiddenBulletins({ database });
  const bulletins = createBulletinsModule({ database, hiddenBulletins });
  const moderation = createModerationModule({
    database,
    findVisibleBulletin: bulletins.findVisibleBulletin,
  });
  // Views gained a table and a procedure with Notify Me (M2.10), so it is now built
  // rather than merely imported: its board grammar is still a pure function bulletins
  // imports directly (ADR-0013), but `app.notify_me_queries` and `views.notifyMe.update`
  // are state and transport, and both need wiring.
  const views = createViewsModule({ database });
  // Notifications is built after graph because it consumes the §6a projection for the
  // delivery-time authorization re-check (ADR-0002 §11). Its saved-query reader is
  // composed inside its own factory from `modules/views`' public directory — see that
  // module's note on why the read does not come through this container.
  // Held in a local because two decisions read it: what the module delivers through,
  // and — via `isPushDeliveryConfigured` below — whether `main.ts` is given a flush to
  // schedule at all. Swapping this one line for a real adapter turns the flush loop on;
  // there is no second switch to remember.
  //
  // ⚠ Refuses every dispatch, on purpose. M2 configures no VAPID key pair, and a
  // silently-dropping transport would mark windows delivered while nobody received
  // anything — see the adapter's own docstring for what replacing it costs.
  const pushTransport = overrides?.pushTransport ?? unconfiguredPushTransport;
  const notifications = createNotificationsModule({
    database,
    visiblePeople: graph.visiblePeople,
    pushTransport,
  });
  // Sync is built last among the routed modules because its registries are adapters
  // over everything above. It is the one module whose dependencies are other modules'
  // use cases rather than the database — which is why the registries are assembled
  // here and never inside it.
  const sync = createSyncModule({
    database,
    handlers: mutationHandlers(bulletins.createBulletin),
    actorshipChecks: mutationActorshipChecks(bulletins.findVisibleBulletin),
  });
  // Audit is built last: it has no router and no other consumer, so nothing else in
  // this function needs it — only the drainer wired immediately below.
  const audit = createAuditModule({ database });
  const outboxDrainer = createOutboxDrainer({
    database,
    consumers: [
      audit.recordAuditEntryConsumer,
      // Adapted rather than passed straight through: this consumer is declared in
      // `modules/notifications/application/`, which `no-domain-to-infrastructure`
      // forbids from importing the entrypoint whose port it implements, so the two
      // ports are stated separately and reconciled here. `outbox-consumer.adapter.ts`
      // is the whole of that reconciliation.
      toDrainerConsumer(notifications.evaluateNotifyMe),
    ],
    // ⚠ The other half of the notifications wiring, and the half whose absence is
    // silent: these rows are read by the grouping-window flush started in `main.ts`,
    // so a drainer that also claimed them would publish them undelivered. Sourced from
    // the module rather than written here so the list cannot drift from the reader
    // that depends on it.
    excludedEventTypes: notifications.selfDrainedEventTypes,
    // One id per process incarnation, not a stable literal: `claimed_by` is a
    // debugging aid rather than a lookup key, so either would be correct today, but a
    // fresh id per boot is also what a second, concurrently-running instance would
    // need — M2-AC24's topology, unobservable on today's single-instance
    // `render.yaml` (m2-lane-briefs.md §L3b-infra's own note) — so there is nothing to
    // revisit if that changes later.
    drainerId: randomUUID(),
  });

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
    // modules/identity's ResolveActorQuery, reading the real app.users (ADR-0011
    // Verification row 4). It replaced `createNoOnboardedUsersResolver`, which was
    // deleted rather than kept: a working implementation of "nobody is signed in"
    // sitting beside the real one is one wiring mistake away from locking every user
    // out with a green test suite.
    actorResolver: identity.actorResolver,
    router: createAppRouter({
      identity: identity.router,
      connections: connections.router,
      graph: graph.router,
      bulletins: bulletins.router,
      moderation: moderation.router,
      sync: sync.router,
      views: views.router,
      notifications: notifications.router,
    }),
    outboxDrainer,
    // The flush is always *built* — the module wires it either way, so nothing about it
    // rots while push is unconfigured. Only its schedulability is conditional.
    notificationFlush: isPushDeliveryConfigured(pushTransport) ? notifications.sendGroupedPush : null,
    dispose: () => database.destroy(),
  };
}
