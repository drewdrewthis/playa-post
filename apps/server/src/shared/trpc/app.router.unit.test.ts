import { describe, expect, it } from 'vitest';

import { createLogger } from '@playa-post/observability';

import { createBulletinsRouter } from '../../modules/bulletins/transport/bulletins.router';
import { createConnectionsRouter } from '../../modules/connections/transport/connections.router';
import { createGraphRouter } from '../../modules/graph/transport/graph.router';
import { createIdentityRouter } from '../../modules/identity/transport/identity.router';
import { createIntrosRouter } from '../../modules/intros/transport/intros.router';
import { createModerationRouter } from '../../modules/moderation/transport/moderation.router';
import { createNotesRouter } from '../../modules/notes/transport/notes.router';
import { createNotificationsRouter } from '../../modules/notifications/transport/notifications.router';
import { createSyncRouter } from '../../modules/sync/transport/sync.router';
import { createViewsRouter } from '../../modules/views/transport/views.router';
import { readHealth } from '../health/read-health';

import { createAppRouter } from './app.router';
import type { RequestContext } from './request-context';
import { createCallerFactory } from './trpc';

const anonymousContext: RequestContext = {
  correlationId: 'correlation-id-for-test',
  logger: createLogger({ level: 'silent' }),
  // A lazy context, as `buildRequestScope` builds one: nothing here resolves
  // credentials until a procedure asks, and `health.check` never does.
  authentication: () => Promise.resolve({ kind: 'anonymous' }),
};

/**
 * Every module router below sits over services that are never reached.
 *
 * These tests are about *registration and routing*, not about any module's behaviour:
 * every assertion calls `health.check` anonymously, and every other procedure refuses
 * an anonymous caller at the middleware, before a service would be consulted. Null
 * objects keep that honest — if a test ever did reach one, it would say so rather than
 * quietly return a fabricated result.
 */
const unreachable = (): Promise<never> =>
  Promise.reject(new Error('module services are not exercised here'));

const appRouter = (): ReturnType<typeof createAppRouter> =>
  createAppRouter({
    identity: createIdentityRouter({
      completeOnboarding: { complete: unreachable },
      visibilitySetting: { get: unreachable, set: unreachable },
    }),
    connections: createConnectionsRouter({
      createInvite: { create: unreachable },
      openInvite: { open: unreachable },
      acceptInvite: { accept: unreachable },
      setConnectionTrust: { set: unreachable },
      getConnection: { get: unreachable },
    }),
    graph: createGraphRouter({ listVisibleGraph: { list: unreachable } }),
    bulletins: createBulletinsRouter({
      createBulletin: { create: unreachable },
      archiveBulletin: { archive: unreachable },
      getBulletin: { getById: unreachable },
      listMyBulletins: { list: unreachable },
      listBoard: { list: unreachable },
    }),
    notes: createNotesRouter({
      pinNote: { pin: unreachable },
      listNotes: { list: unreachable },
    }),
    intros: createIntrosRouter({
      listIntroViaCandidates: { list: unreachable },
      requestIntro: { request: unreachable },
      listIntroInbox: { list: unreachable },
      listIntroOutbox: { list: unreachable },
      decideIntro: { decide: unreachable },
      respondToIntro: { respond: unreachable },
    }),
    moderation: createModerationRouter({
      reportBulletin: { report: unreachable },
      dismissBulletin: { dismiss: unreachable },
    }),
    sync: createSyncRouter({ submitMutations: { submit: unreachable } }),
    views: createViewsRouter({
      updateNotifyMeQuery: { update: unreachable },
      listSavedViews: { list: unreachable },
      saveView: { save: unreachable },
      renameSavedView: { rename: unreachable },
      deleteSavedView: { delete: unreachable },
      setSavedViewNotify: { set: unreachable },
    }),
    notifications: createNotificationsRouter({
      subscribeToPush: { subscribe: unreachable },
      listNotifications: { list: unreachable },
      markNotificationsSeen: { markSeen: unreachable },
      dismissNotification: { dismiss: unreachable },
    }),
  });

describe('createAppRouter', () => {
  it('answers health.check with the same payload GET /healthz returns', () => {
    const caller = createCallerFactory(appRouter())(anonymousContext);

    // Compared against readHealth() rather than a literal so the two transports have
    // one source of truth; a drift between them would mean the API and the deploy
    // probe disagree about whether this process is up.
    return expect(caller.health.check()).resolves.toEqual(readHealth());
  });

  it('answers health.check without credentials — liveness must not need a session', async () => {
    const caller = createCallerFactory(appRouter())(anonymousContext);

    await expect(caller.health.check()).resolves.toBeDefined();
  });

  it('is a factory, so two calls produce independent routers', () => {
    // Now that it takes module routers as a parameter, a module-scope singleton would
    // silently share one lane's wiring with another's.
    expect(appRouter()).not.toBe(appRouter());
  });

  // Addendum §4 / lane-brief C5: a registered-but-empty router is the placeholder the
  // addendum forbids. This fails the moment someone removes the last procedure without
  // removing the router.
  it('registers at least one real procedure', () => {
    const procedures = Object.keys(appRouter()._def.procedures);

    expect(procedures).toContain('health.check');
  });

  it('mounts the identity module under its own namespace (lane-brief C5)', () => {
    const procedures = Object.keys(appRouter()._def.procedures);

    expect(procedures).toContain('identity.completeOnboarding');
  });
});
