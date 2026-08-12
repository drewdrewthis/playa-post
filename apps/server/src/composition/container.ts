import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet } from 'jose';
import { z } from 'zod';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger, DEFAULT_ALLOWED_LOG_FIELDS, type Logger } from '@playa-post/observability';

import { createOutboxDrainer, type OutboxDrainer } from '../entrypoints/outbox-drainer/outbox-drainer';
import {
  createSoftDeletedRowPurge,
  type SoftDeletedRowPurge,
} from '../entrypoints/purge/purge-soft-deleted-rows';
import { createAuditModule } from '../modules/audit/audit.module';
import type { CreateBulletinService } from '../modules/bulletins/application/create-bulletin.service';
import type { FindVisibleBulletinAuthor } from '../modules/bulletins/application/find-visible-bulletin-author.query';
import { createBulletinsModule } from '../modules/bulletins/bulletins.module';
import { presentBulletin } from '../modules/bulletins/transport/bulletin.presenter';
import {
  createBulletinCommandFields,
  createBulletinInput,
} from '../modules/bulletins/transport/create-bulletin.input';
import { createConnectionsModule } from '../modules/connections/connections.module';
import { createGraphModule } from '../modules/graph/graph.module';
import { createIdentityModule } from '../modules/identity/identity.module';
import { createIntrosModule } from '../modules/intros/intros.module';
import {
  createDismissedBulletins,
  createHiddenBulletins,
  createModerationModule,
} from '../modules/moderation/moderation.module';
import type { PinNoteService } from '../modules/notes/application/pin-note.service';
import { createNotesModule } from '../modules/notes/notes.module';
import { presentNote } from '../modules/notes/transport/note.presenter';
import { pinNoteCommandFields, pinNoteInput } from '../modules/notes/transport/pin-note.input';
import type { SendGroupedPushHandler } from '../modules/notifications/application/send-grouped-push.handler';
import { isPushDeliveryConfigured, type PushTransport } from '../modules/notifications/domain/push-transport';
import { unconfiguredPushTransport } from '../modules/notifications/infrastructure/unconfigured-push.transport';
import { createWebPushTransport } from '../modules/notifications/infrastructure/web-push.transport';
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
 *   `bulletin.dismiss`, `bulletin.undismiss`). The service behind each still enforces its
 *   own rules — an
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
 * The `MutationType → handler` registry — two replayable handlers.
 *
 * Neither needs an actorship check: in both cases the author is the acting actor, so
 * there is no pre-existing subject for them to be unrelated to (see
 * `create-bulletin.service.ts` and `mutation-type.ts`'s note on `note.pin`). Each result
 * is its module's presenter output, deliberately — a client must not be able to tell from
 * the payload whether its change went through the tRPC procedure or the offline queue.
 *
 * ⚠ `note.pin` differs from `bulletin.create` in one way that matters offline: it has a
 * refusal a queued envelope can hit. A recipient who was a first-degree connection when
 * the note was composed may not be one when the queue drains, and the insert refuses it —
 * so the envelope comes back `rejected` with `NOTE_RECIPIENT_UNREACHABLE` and no row
 * lands. That is an `ApplicationError` and therefore per-envelope, never batch-fatal
 * (ADR-0005).
 */
function mutationHandlers(
  createBulletin: CreateBulletinService,
  pinNote: PinNoteService,
): MutationHandlerRegistry {
  return {
    'note.pin': {
      async handle({ actorId, mutationType, payload }) {
        const parsed = pinNoteInput.safeParse(payload);

        if (!parsed.success) {
          throw new MutationPayloadInvalidError(mutationType);
        }

        return {
          result: presentNote(
            await pinNote.pin({
              // From the resolved actor, never from the payload (ADR-0002 §5a, B14) —
              // the one line in the offline path where writing a note in somebody else's
              // name would live.
              authorId: actorId,
              // Field-for-field with the tRPC procedure, through the one mapping both
              // call.
              ...pinNoteCommandFields(parsed.data),
            }),
          ),
        };
      },
    },

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
              // Field-for-field with the tRPC procedure, through the one mapping both
              // call: a queued bulletin that lost its location or its expiry on the way
              // back online would be a silent difference between the two paths.
              ...createBulletinCommandFields(parsed.data),
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
 *
 * ⚠ `bulletin.create` and `note.pin` are **not** on that list of gaps: neither names a
 * pre-existing subject, so there is nothing for an actorship gate to check. `note.pin`
 * does name a *recipient*, and that claim is authorized inside its insert statement
 * rather than here — a pre-dispatch check would be a second answer to it, and the
 * cheaper of two answers always wins the race.
 */
function mutationActorshipChecks(
  findVisibleBulletin: FindVisibleBulletinAuthor,
): MutationActorshipCheckRegistry {
  return {
    'bulletin.archive': requireBulletinActorship(findVisibleBulletin, true),
    'bulletin.report': requireBulletinActorship(findVisibleBulletin, false),
    'bulletin.dismiss': requireBulletinActorship(findVisibleBulletin, false),
    // The same gate as `bulletin.dismiss`, and the symmetry is the requirement (#170):
    // `UndismissBulletinService` asks the identical question on the direct path, so a
    // queued un-dismissal cannot be refused for a reason the online one would not raise.
    'bulletin.undismiss': requireBulletinActorship(findVisibleBulletin, false),
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
   * (M2.11), or **`null` when the wired push transport cannot deliver** — which is any
   * deployment without the three `VAPID_*` keys, including every local checkout.
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
   * `purgeOnce({ now })` hard-deletes every soft-deleted row older than
   * `PURGE_RETENTION_DAYS` (issue #169). Exposed here, unstarted, for the same reason
   * {@link outboxDrainer} is — *when* it runs is
   * `entrypoints/purge/start-purge-poller.ts`'s job.
   *
   * Never `null`, unlike {@link notificationFlush}: there is no configuration in which a
   * retention sweep has nothing it could do, and a deployment that quietly skipped it
   * would keep every deleted row forever, which is the whole of what #169 fixes.
   */
  readonly softDeletePurge: SoftDeletedRowPurge;
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
 *   be schedulable without reaching a push service — the e2e's recording transport in
 *   `tests/e2e/global-setup.ts` is the one caller. Absent, the transport follows
 *   `configuration.webPush`: the real `web-push` adapter when the three VAPID keys are
 *   set, `unconfiguredPushTransport` when they are not.
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
  //
  // ⚠ Two reads, built separately and never merged (#170): `hiddenBulletins` unions
  // reports and dismissals, because the board's exclusion does not care which one hid a
  // bulletin; `dismissedBulletins` returns dismissals alone, because that one is
  // browsable and a report list is not (M2-AC10, B9). Both are the same persistence
  // implementation constructed twice, narrowed to two disjoint types — and the types
  // are what keep the browsable one unable to grow a report.
  const hiddenBulletins = createHiddenBulletins({ database });
  const dismissedBulletins = createDismissedBulletins({ database });
  const bulletins = createBulletinsModule({ database, hiddenBulletins, dismissedBulletins });
  // Notes is built beside bulletins and depends on neither it nor graph: `app.visible_notes`
  // composes `app.visible_people` in SQL, and the pin statement does the same, so the
  // wiring order between the three carries no meaning. Beside rather than inside is the
  // point — PDF §6 keeps fixed-recipient messaging out of the bulletin model, and
  // decision D6 makes that separation structural (issue #88).
  const notes = createNotesModule({ database });
  // Intros is built beside notes and depends on neither it nor graph: eligibility is
  // `app.intro_via_candidates` composing `app.visible_people` in SQL, and both write
  // statements compose that function in turn — so there is no TypeScript edge here and
  // none may be added. Injecting a graph repository would put a second definition of
  // reachability one convenience method away (issue #89, ADR-0002 §6).
  //
  // ⚠ It takes nothing from `connections` either, although accepting an introduction is
  // what creates a connection (issue #166). That seam is the `IntroAccepted` outbox event
  // and `connections.connectIntroducedPair` below — decision D12 — so the acceptance and
  // its event are one transaction and the edge is written by the module that owns the
  // table. A dependency here would be the two-transaction version, whose failure is
  // unrecoverable because answering an introduction is terminal-once.
  const intros = createIntrosModule({ database });
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
  // schedule at all. One switch, read twice; there is no second one to remember.
  //
  // ⚠ **`configuration.webPush` is the whole switch.** With the three VAPID keys set,
  // this is real delivery and the flush loop runs. Without them the transport refuses
  // every dispatch on purpose, because a silently-dropping one would mark windows
  // delivered while nobody received anything — see `unconfigured-push.transport.ts`.
  // The environment is read here and only here: a module reaching for `process.env`
  // would be a hidden dependency the boundary rules cannot see (addendum §12).
  //
  // The override stays outermost so a harness injecting its own transport is unaffected
  // by whatever the environment happens to carry (the e2e's recording transport, issue
  // #31 option 2).
  const pushTransport =
    overrides?.pushTransport ??
    (configuration.webPush === null
      ? unconfiguredPushTransport
      : createWebPushTransport({ vapid: configuration.webPush, log: logger }));
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
    handlers: mutationHandlers(bulletins.createBulletin, notes.pinNote),
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
      // ⚠ The whole of "a pinned note reaches the bell" (issue #149). This consumer's
      // receipt is what `notifications.list` joins a `NotePinned` row to, so leaving it
      // out does not delay a notification — it means the notification never exists, and
      // nothing errors. `container-notification-wiring.unit.test.ts` holds the line.
      toDrainerConsumer(notifications.deliverNotePinned),
      // ⚠ The whole of "accepting an introduction connects you" (issue #166, decision
      // D12), and its absence is silent in the same way: `modules/intros` would still
      // record the acceptance, nothing would throw, and the two people would simply never
      // become connected. Passed straight through rather than adapted — this consumer is
      // built in `modules/connections/persistence/`, which those boundary rules leave free
      // to name the drainer's own port, so there is no second declaration to reconcile.
      connections.connectIntroducedPair,
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
  // ⚠ **The one place that knows which tables carry a soft delete.** The sweep itself
  // knows only "targets"; each module knows only its own rows; this line is where the two
  // meet, exactly as `consumers` above is for the drainer. A third deletable entity
  // arrives as a third entry here and changes nothing in `entrypoints/purge/`.
  //
  // `modules/notes` is deliberately absent: notes have no delete at all (decision D17,
  // and D6's "no lifecycle" corollary that D14 kept), so there is no soft-deleted row for
  // a target to sweep. A target over `app.notes` would be a statement that can only ever
  // match zero rows — the empty abstraction §4 forbids, run hourly forever.
  //
  // The names are stable labels for the round's log line and are chosen here rather than
  // inside the modules, because they describe what an operator is reading rather than
  // what a module calls itself.
  const softDeletePurge = createSoftDeletedRowPurge({
    retentionDays: configuration.purgeRetentionDays,
    targets: [
      { name: 'removed bulletins', purge: (before) => bulletins.removedBulletins.purge(before) },
      { name: 'deleted saved views', purge: (before) => views.deletedSavedViews.purge(before) },
    ],
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
      notes: notes.router,
      intros: intros.router,
      moderation: moderation.router,
      sync: sync.router,
      views: views.router,
      notifications: notifications.router,
    }),
    outboxDrainer,
    // The flush is always *built* — the module wires it either way, so nothing about it
    // rots while push is unconfigured. Only its schedulability is conditional.
    notificationFlush: isPushDeliveryConfigured(pushTransport) ? notifications.sendGroupedPush : null,
    softDeletePurge,
    dispose: () => database.destroy(),
  };
}
