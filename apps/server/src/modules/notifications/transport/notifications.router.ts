import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { DismissNotificationService } from '../application/dismiss-notification.service';
import type { ListNotificationsQuery } from '../application/list-notifications.query';
import type { MarkNotificationsSeenService } from '../application/mark-notifications-seen.service';
import type { NotificationSettingsService } from '../application/notification-settings.service';
import type { SubscribeToPushService } from '../application/subscribe-to-push.service';
import { NotificationUnavailableError } from '../domain/notification.errors';

import {
  presentNotification,
  presentNotificationDismissal,
  presentNotificationSeenMark,
  presentNotificationSettings,
  type PresentedNotification,
  type PresentedNotificationDismissal,
  type PresentedNotificationSeenMark,
  type PresentedNotificationSettings,
} from './grouped-notification.presenter';
import { notificationIdInput } from './notification-id.input';
import { subscribeToPushInput } from './subscribe-to-push.input';
import { updateNotificationSettingInput } from './update-notification-setting.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface NotificationsRouterDependencies {
  readonly subscribeToPush: SubscribeToPushService;
  readonly listNotifications: ListNotificationsQuery;
  readonly markNotificationsSeen: MarkNotificationsSeenService;
  readonly dismissNotification: DismissNotificationService;
  readonly notificationSettings: NotificationSettingsService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * **`NOTIFICATION_UNAVAILABLE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403 would
 * confirm that the identifier names a real notification belonging to somebody else; 404
 * is the same answer an invented one gets, which is what ADR-0002 §10 asks for and the
 * identical decision `bulletins.router.ts` makes for `BULLETIN_GONE`.
 *
 * **`push.subscribe` has no refusal to map.** It answered `CONFLICT` on a second
 * enrollment while the write was insert-only; it stores by replacement now
 * (`subscribe-to-push.service.ts`), so there is no state in which a well-formed
 * subscription is turned away. A status a client can only respond to by guessing —
 * "is the stored subscription mine, or a dead one?" — is worse than no status.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof NotificationUnavailableError ? 'NOT_FOUND' : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * The same three steps `bulletins.router.ts` factors out, for the same reason: a
 * forgotten `catch` is a 500 carrying a message written for a log rather than for a
 * caller.
 */
async function present<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw asTrpcError(error);
    }
    throw error;
  }
}

/**
 * The notifications module's tRPC surface.
 *
 * **Six procedures, and the delivery half of this module still has none on purpose.**
 * `EvaluateNotifyMeHandler` is an outbox consumer and `SendGroupedPushHandler` is a
 * scheduled flush (ADR-0006's "notification grouping window flush") — neither has a
 * caller who could sensibly invoke it over HTTP, and exposing "flush now" would hand a
 * client a lever on other people's notification timing. `list` reports what that flush
 * already did; it never causes one.
 *
 * `subscribe` is nested under `push` so the path spells what it acts on, the same
 * convention `connections.trust.set` follows. `list`, `markSeen` and `dismiss` are not,
 * because they are about notifications rather than about the push transport — a person
 * reading or clearing their panel has one whether or not a device is subscribed.
 * Notification *preferences* are the promised sibling, arrived as `settings` (issue
 * #209, ADR-0020): per-kind switches, not per-device transport state.
 *
 * **There is deliberately no `dismissAll`.** The panel's "CLEAR ALL" is the client
 * calling `dismiss` once per notification it is currently showing, which is the only
 * version that cannot clear something the person never saw — a server-side "all" would
 * race the read it was based on and swallow whatever arrived in between.
 */
export function createNotificationsRouter(dependencies: NotificationsRouterDependencies) {
  return router({
    /**
     * The caller's own grouped notifications, newest first.
     *
     * **No input at all**, the same statement `graph.list` makes: there is exactly one
     * person's notifications a caller may read, so there is no parameter that could name
     * a different one (ADR-0002 §5a). `ctx.viewerId` is minted by the
     * `authenticatedProcedure` middleware from the resolved `Actor` and is the only
     * `ViewerId` in the system.
     */
    list: authenticatedProcedure.query(
      async ({ ctx }): Promise<readonly PresentedNotification[]> =>
        present(async () =>
          (await dependencies.listNotifications.list({ viewerId: ctx.viewerId })).map(
            presentNotification,
          ),
        ),
    ),

    /**
     * Say that you have your notifications panel open now (issue #178).
     *
     * **No input at all**, for two reasons rather than one. The first is `list`'s: there
     * is exactly one person's watermark a caller may move (ADR-0002 §5a). The second is
     * the design — the watermark claims "everything up to now", deliberately covering
     * even what arrived since the caller's last read (decision D7's accepted
     * consequence), so there is no identifier list to carry, and none to trust.
     *
     * Viewer-local and nothing else: it changes what `list` marks `seen` for the caller,
     * which is what their bell's badge counts. It dismisses nothing — every notification
     * stays exactly where it was in the panel — and it has no effect on any other
     * recipient, on delivery, or on the bulletins and notes behind it.
     *
     * ⚠ **Not idempotent, deliberately.** Every call advances `seenAt`; see
     * {@link import('../application/mark-notifications-seen.service').MarkNotificationsSeenService}.
     * It is still safe to repeat — the watermark never moves backwards.
     */
    markSeen: authenticatedProcedure.mutation(
      async ({ ctx }): Promise<PresentedNotificationSeenMark> =>
        present(async () =>
          presentNotificationSeenMark(
            await dependencies.markNotificationsSeen.markSeen({ actorId: ctx.actor.userId }),
          ),
        ),
    ),

    /**
     * Take a notification out of your own unread set.
     *
     * Viewer-local and nothing else: it changes what `list` marks `unread` for the
     * caller, and has no effect on any other recipient, on delivery, or on the bulletins
     * behind it. The notification stays in `list` with `unread: false` rather than
     * disappearing — see
     * {@link import('../application/grouped-notification').GroupedNotification.unread}.
     *
     * Idempotent: dismissing twice returns the first `dismissedAt`.
     */
    dismiss: authenticatedProcedure
      .input(notificationIdInput)
      .mutation(async ({ ctx, input }): Promise<PresentedNotificationDismissal> =>
        present(async () =>
          presentNotificationDismissal(
            await dependencies.dismissNotification.dismiss({
              actorId: ctx.actor.userId,
              notificationId: input.notificationId,
            }),
          ),
        ),
      ),

    settings: router({
      /**
       * The caller's own per-kind switches, every kind, in a stable order.
       *
       * **No input at all**, `list`'s statement: there is exactly one person's settings
       * a caller may read (ADR-0002 §5a). `enabled` is derived from the absence of an
       * opt-out row, so a person who never opened this panel reads all-on (ADR-0020).
       */
      get: authenticatedProcedure.query(
        async ({ ctx }): Promise<PresentedNotificationSettings> =>
          present(async () =>
            presentNotificationSettings(
              await dependencies.notificationSettings.get(ctx.actor.userId),
            ),
          ),
      ),

      /**
       * Move one switch, answering where they all now stand.
       *
       * Idempotent in both directions — a retry converges — and viewer-local and
       * nothing else: it changes which *future* events produce a notification for the
       * caller, and touches nothing already delivered, no other recipient, and no
       * device's push enrollment.
       */
      update: authenticatedProcedure
        .input(updateNotificationSettingInput)
        .mutation(async ({ ctx, input }): Promise<PresentedNotificationSettings> =>
          present(async () =>
            presentNotificationSettings(
              await dependencies.notificationSettings.update(
                ctx.actor.userId,
                input.kind,
                input.enabled,
              ),
            ),
          ),
        ),
    }),

    push: router({
      /**
       * Register this device for Web Push.
       *
       * Returns nothing: the caller sent the subscription, so echoing it back would put
       * a routable push credential in a response body for no reason.
       */
      subscribe: authenticatedProcedure
        .input(subscribeToPushInput)
        .mutation(async ({ ctx, input }): Promise<void> => {
          await present(async () => {
            await dependencies.subscribeToPush.subscribe({
              actorId: ctx.actor.userId,
              endpoint: input.endpoint,
              keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
            });
          });
        }),
    }),
  });
}

/** The notifications router's type, for the root router to mount it by. */
export type NotificationsRouter = ReturnType<typeof createNotificationsRouter>;
