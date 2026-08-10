import type { DatabaseConnection } from '@playa-post/database';

import type { VisiblePeopleDirectory } from '../graph/graph.module';
import { createNotifyMeQueryDirectory } from '../views/views.module';

import { createDismissNotificationService } from './application/dismiss-notification.service';
import {
  createEvaluateNotifyMeHandler,
  type EvaluateNotifyMeHandler,
} from './application/evaluate-notify-me.handler';
import { createListNotificationsQuery } from './application/list-notifications.query';
import {
  createSendGroupedPushHandler,
  type SendGroupedPushHandler,
} from './application/send-grouped-push.handler';
import { createSubscribeToPushService } from './application/subscribe-to-push.service';
import { SELF_DRAINED_EVENT_TYPES } from './domain/notification.events';
import type { PushTransport } from './domain/push-transport';
import { createPostgresDeliveredNotificationRepository } from './persistence/postgres-delivered-notification.repository';
import { createPostgresNotificationDismissalRepository } from './persistence/postgres-notification-dismissal.repository';
import { createPostgresNotifyMeMatchRepository } from './persistence/postgres-notify-me-match.repository';
import { createPostgresPushSubscriptionRepository } from './persistence/postgres-push-subscription.repository';
import {
  createNotificationsRouter,
  type NotificationsRouter,
} from './transport/notifications.router';

/** What the composition root has to hand this module. */
export interface NotificationsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /**
   * `modules/graph`'s §6a person projection (lane-brief C8, ratified decision (c)).
   *
   * Injected rather than built here because it is L2's export and the *one* answer to
   * "who can this person see" — the delivery-time authorization re-check
   * (ADR-0002:274-279) asks it, and a notification path that answered that question for
   * itself would be R2's second definition in the least observable place in the system.
   */
  readonly visiblePeople: VisiblePeopleDirectory;
  /**
   * Whatever actually delivers a Web Push.
   *
   * Injected because it is the one collaborator with a network on the other side: the
   * integration suite hands in a fake to prove the payload shape and the suppression,
   * and `composition/container.ts` hands in
   * {@link import('./infrastructure/web-push.transport').createWebPushTransport}'s
   * adapter when the deployment has VAPID keys and
   * {@link import('./infrastructure/unconfigured-push.transport').unconfiguredPushTransport}
   * when it does not.
   */
  readonly pushTransport: PushTransport;
}

/** What the composition root gets back: a router, and the two handlers. */
export interface NotificationsModule {
  readonly router: NotificationsRouter;
  /**
   * The `BulletinCreated` consumer, for the outbox drainer to route to (M2.14).
   *
   * Leaves the module because a consumer is useless until something delivers to it,
   * and the drainer is an entrypoint rather than a module — it cannot reach in, so the
   * subscription has to be handed out here.
   */
  readonly evaluateNotifyMe: EvaluateNotifyMeHandler;
  /**
   * The grouping-window flush, for the scheduler to call (ADR-0006's scheduled work).
   *
   * Not a consumer: it is driven by a clock, not by an event, which is why its
   * entrypoint is `flush({ now })` rather than `handle(event)`.
   */
  readonly sendGroupedPush: SendGroupedPushHandler;
  /**
   * The event types {@link sendGroupedPush} drains itself, for the composition root to
   * pass to the outbox drainer as its exclusion list.
   *
   * Leaves the module for the same reason {@link evaluateNotifyMe} does — the drainer
   * is an entrypoint and cannot reach in — but says the opposite thing: *this* is what
   * the drainer must **not** deliver, because something in here already reads it.
   * Definition and rationale:
   * {@link import('./domain/notification.events').SELF_DRAINED_EVENT_TYPES}.
   */
  readonly selfDrainedEventTypes: readonly string[];
}

/**
 * Wire the notifications module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repositories and injects them.
 *
 * ⚠ **The saved Notify Me queries come from `modules/views`' public factory, not from a
 * `SELECT` in this module.** `app.notify_me_queries` is views' table (ADR-0007:77-79),
 * and addendum §19 routes a cross-module read through "a small public application
 * interface" — never a second module's query against somebody else's table, which no
 * boundary rule can see once it is written as an inline Kysely builder. Composing it
 * here rather than taking it as a dependency keeps this factory's signature to the
 * three things the composition root genuinely chooses: a connection, the §6a
 * projection, and a transport.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createNotificationsModule(
  dependencies: NotificationsModuleDependencies,
): NotificationsModule {
  const { database, visiblePeople, pushTransport } = dependencies;

  const matches = createPostgresNotifyMeMatchRepository({ database });
  const pushSubscriptions = createPostgresPushSubscriptionRepository({ database });
  const deliveredNotifications = createPostgresDeliveredNotificationRepository({ database });
  const dismissals = createPostgresNotificationDismissalRepository({ database });

  return {
    router: createNotificationsRouter({
      subscribeToPush: createSubscribeToPushService({ pushSubscriptions }),
      listNotifications: createListNotificationsQuery({ deliveredNotifications, dismissals }),
      // The read and the write share both collaborators on purpose: `unread` is the
      // negation of what `dismiss` writes, so a second store behind either one would be
      // two answers to one question.
      dismissNotification: createDismissNotificationService({ deliveredNotifications, dismissals }),
    }),
    evaluateNotifyMe: createEvaluateNotifyMeHandler({
      notifyMeQueries: createNotifyMeQueryDirectory({ database }),
      matches,
    }),
    sendGroupedPush: createSendGroupedPushHandler({
      matches,
      pushSubscriptions,
      visiblePeople,
      pushTransport,
    }),
    selfDrainedEventTypes: SELF_DRAINED_EVENT_TYPES,
  };
}
