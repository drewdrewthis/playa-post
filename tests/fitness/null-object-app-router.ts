import { createBulletinsRouter } from '../../apps/server/src/modules/bulletins/transport/bulletins.router';
import { createConnectionsRouter } from '../../apps/server/src/modules/connections/transport/connections.router';
import { createGraphRouter } from '../../apps/server/src/modules/graph/transport/graph.router';
import { createIdentityRouter } from '../../apps/server/src/modules/identity/transport/identity.router';
import { createIntrosRouter } from '../../apps/server/src/modules/intros/transport/intros.router';
import { createModerationRouter } from '../../apps/server/src/modules/moderation/transport/moderation.router';
import { createNotesRouter } from '../../apps/server/src/modules/notes/transport/notes.router';
import { createNotificationsRouter } from '../../apps/server/src/modules/notifications/transport/notifications.router';
import { createSyncRouter } from '../../apps/server/src/modules/sync/transport/sync.router';
import { createViewsRouter } from '../../apps/server/src/modules/views/transport/views.router';
import { createAppRouter } from '../../apps/server/src/shared/trpc/app.router';

/**
 * The router this process serves, assembled the way `composition/container.ts`
 * assembles it, with a null object behind every procedure.
 *
 * **One registry, three consumers** — `viewer-id-provenance.fitness.test.ts` (B14),
 * `contracts-api-parity.fitness.test.ts` (the contracts drift gate), and
 * `tests/security/viewer-id-provenance.security.test.ts`. It lives in its own file
 * precisely because it is maintained by hand: three copies of a hand-maintained
 * registry is three chances for a module to go unwatched, and a control that has
 * stopped seeing a module is worse than one that is openly `pending`.
 *
 * ⚠ **Every module a lane mounts has to be listed here.** `createAppRouter`'s
 * parameter is the whole registry, so a missing module is a compile error rather than
 * a silent gap — which is the only reason maintaining it by hand is safe at all.
 */

/**
 * Every application service behind these routers is a null object: the consumers read
 * input *schemas* and procedure *types* and never invoke a procedure, so a working
 * service would add nothing but a database. A rejection rather than a stub value keeps
 * that assumption checkable.
 */
const unreachable = (): Promise<never> =>
  Promise.reject(new Error('no procedure is invoked by this router'));

/** How many procedures the assembled router serves. Asserted, never inferred. */
export const EXPECTED_PROCEDURE_COUNT = 36;

/** Build the whole ten-module router with no infrastructure behind it. */
export function buildNullObjectAppRouter(): ReturnType<typeof createAppRouter> {
  return createAppRouter({
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
}
