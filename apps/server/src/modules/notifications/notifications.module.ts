import type { DatabaseConnection } from '@playa-post/database';

import type { VisiblePeopleDirectory } from '../graph/graph.module';
import { createNotifyMeQueryDirectory } from '../views/views.module';

import {
  createDeliverNotePinnedHandler,
  type DeliverNotePinnedHandler,
} from './application/deliver-note-pinned.handler';
import { createDismissNotificationService } from './application/dismiss-notification.service';
import {
  createEvaluateNotifyMeHandler,
  type EvaluateNotifyMeHandler,
} from './application/evaluate-notify-me.handler';
import { createListNotificationsQuery } from './application/list-notifications.query';
import { createMarkNotificationsSeenService } from './application/mark-notifications-seen.service';
import { createNotificationSettingsService } from './application/notification-settings.service';
import {
  createSendGroupedPushHandler,
  type SendGroupedPushHandler,
} from './application/send-grouped-push.handler';
import { createSubscribeToPushService } from './application/subscribe-to-push.service';
import { SELF_DRAINED_EVENT_TYPES } from './domain/notification.events';
import type { PushTransport } from './domain/push-transport';
import { createPostgresDeliveredNotificationRepository } from './persistence/postgres-delivered-notification.repository';
import { createPostgresNoteNotificationRepository } from './persistence/postgres-note-notification.repository';
import { createPostgresNotificationDismissalRepository } from './persistence/postgres-notification-dismissal.repository';
import { createPostgresNotificationOptoutRepository } from './persistence/postgres-notification-optout.repository';
import { createPostgresNotificationSeenWatermarkRepository } from './persistence/postgres-notification-seen-watermark.repository';
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

/** What the composition root gets back: a router, and the three handlers. */
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
   * The `NotePinned` consumer, for the outbox drainer to route to (issue #149).
   *
   * Leaves the module for the same reason {@link evaluateNotifyMe} does. ⚠ **Registering
   * it is not optional decoration**: its receipt is what makes a pinned note appear in
   * its recipient's bell at all, so an unregistered consumer is a silently empty feature
   * rather than a delivery that is merely late.
   */
  readonly deliverNotePinned: DeliverNotePinnedHandler;
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
  const noteNotifications = createPostgresNoteNotificationRepository({ database });
  const dismissals = createPostgresNotificationDismissalRepository({ database });
  const seenWatermarks = createPostgresNotificationSeenWatermarkRepository({ database });
  const optouts = createPostgresNotificationOptoutRepository({ database });

  return {
    router: createNotificationsRouter({
      subscribeToPush: createSubscribeToPushService({ pushSubscriptions }),
      listNotifications: createListNotificationsQuery({
        deliveredNotifications,
        dismissals,
        seenWatermarks,
      }),
      // The read and the write share both collaborators on purpose: `unread` is the
      // negation of what `dismiss` writes, so a second store behind either one would be
      // two answers to one question.
      dismissNotification: createDismissNotificationService({ deliveredNotifications, dismissals }),
      // Same reason again, for the second pair: `seen` is a comparison against exactly
      // what `markSeen` writes (issue #178). ⚠ It takes no `deliveredNotifications` —
      // there is no notification to prove ownership of, because the command names none.
      markNotificationsSeen: createMarkNotificationsSeenService({ seenWatermarks }),
      notificationSettings: createNotificationSettingsService({ optouts }),
    }),
    evaluateNotifyMe: createEvaluateNotifyMeHandler({
      notifyMeQueries: createNotifyMeQueryDirectory({ database }),
      matches,
    }),
    // No push transport and no `visiblePeople`: a note notification is delivered to the
    // bell by existing, and whether the viewer may still read it is decided by
    // `app.visible_notes` on the read path rather than by anything this handler holds.
    // `optouts` is the per-kind off-switch (issue #209, ADR-0020 D4).
    deliverNotePinned: createDeliverNotePinnedHandler({ noteNotifications, optouts }),
    sendGroupedPush: createSendGroupedPushHandler({
      matches,
      pushSubscriptions,
      visiblePeople,
      pushTransport,
    }),
    selfDrainedEventTypes: SELF_DRAINED_EVENT_TYPES,
  };
}
