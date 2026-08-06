import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { ListNotificationsQuery } from '../application/list-notifications.query';
import type { SubscribeToPushService } from '../application/subscribe-to-push.service';
import { PushSubscriptionAlreadyExistsError } from '../domain/push-subscription.errors';

import { presentNotification, type PresentedNotification } from './grouped-notification.presenter';
import { subscribeToPushInput } from './subscribe-to-push.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface NotificationsRouterDependencies {
  readonly subscribeToPush: SubscribeToPushService;
  readonly listNotifications: ListNotificationsQuery;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * `PUSH_SUBSCRIPTION_EXISTS` is `CONFLICT`: the request was well formed and the state
 * refused it, which is what tells a client to stop retrying and reconcile instead. It
 * is deliberately not `BAD_REQUEST` — nothing about the submitted subscription was
 * wrong — and deliberately not silently successful, because a client that believes it
 * subscribed a second device would wait for pushes that go elsewhere.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof PushSubscriptionAlreadyExistsError ? 'CONFLICT' : 'BAD_REQUEST';

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
 * **Two procedures, and the delivery half of this module still has none on purpose.**
 * `EvaluateNotifyMeHandler` is an outbox consumer and `SendGroupedPushHandler` is a
 * scheduled flush (ADR-0006's "notification grouping window flush") — neither has a
 * caller who could sensibly invoke it over HTTP, and exposing "flush now" would hand a
 * client a lever on other people's notification timing. `list` reports what that flush
 * already did; it never causes one.
 *
 * `subscribe` is nested under `push` so the path spells what it acts on, the same
 * convention `connections.trust.set` follows. `list` is not, because it is about
 * notifications rather than about the push transport — a person reading their panel has
 * one whether or not a device is subscribed. Notification *preferences* are M5 and
 * arrive as a sibling.
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
