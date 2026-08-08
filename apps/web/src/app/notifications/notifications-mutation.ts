import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { GroupedNotification } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';

import { dismissEachNotification } from './dismiss-notifications';
import { NOTIFICATIONS_QUERY_KEY } from './notifications-query';

/**
 * Dismissing notifications, as the panel needs it: optimistic, honest about refusals.
 *
 * Named for the controls rather than the act, because `NotificationDismissal` is already
 * the contract's name for what the server sends back from one `notifications.dismiss`.
 */
export interface DismissalControls {
  /**
   * Dismiss these notifications. One id is the row's `✕`; every unread id is
   * "CLEAR ALL". Both are the same operation, so both tolerate a refusal the same way.
   */
  dismiss(notificationIds: readonly string[]): void;
  /** True while a dismissal is in flight — the affordances disable rather than queue. */
  readonly pending: boolean;
  /** How many of the last batch the server refused. Zero while another is in flight. */
  readonly refusedCount: number;
}

/**
 * Flip `unread` on the notifications named, in the cache the panel and the bell read.
 *
 * Not a full refetch: the point of the optimistic write is that the row responds to the
 * tap, and the server's answer arrives after.
 */
function setUnread(
  queryClient: QueryClient,
  notificationIds: readonly string[],
  unread: boolean,
): void {
  if (notificationIds.length === 0) {
    return;
  }

  const named = new Set(notificationIds);

  queryClient.setQueryData<readonly GroupedNotification[]>(
    NOTIFICATIONS_QUERY_KEY,
    (current) =>
      current?.map((notification) =>
        named.has(notification.notificationId) ? { ...notification, unread } : notification,
      ),
  );
}

/**
 * The panel's dismiss affordances, bound to `notifications.dismiss`.
 *
 * Optimistic, and therefore obliged to be honest: the rows go read the instant they are
 * tapped, and **exactly the ones the server refuses come back unread** rather than the
 * whole batch rolling back or none of it. A `NOTIFICATION_UNAVAILABLE` on one aged-out
 * row is the ordinary case, and it says nothing about its neighbours.
 *
 * ⚠ **`onSettled` invalidates whatever the optimistic write claimed.** The server is
 * the answer; the optimistic write only decides how long the reader waits to see it.
 *
 * Online-only, unlike the board's archive: `notification.dismiss` is deliberately absent
 * from `MUTATION_TYPES`, so ADR-0005's conflict matrix does not define it and the offline
 * queue would replay it as `rejected` / `UNSUPPORTED_MUTATION_TYPE`. Routing this through
 * `queueMutation` would look more robust and be strictly less so.
 */
export function useNotificationDismissal(): DismissalControls {
  const api = useApi();
  const queryClient = useQueryClient();

  const dismissal = useMutation({
    mutationFn: (notificationIds: readonly string[]) =>
      dismissEachNotification(notificationIds, (notificationId) =>
        api.mutate('notifications.dismiss', { notificationId }),
      ),

    onMutate: async (notificationIds) => {
      // The list polls while the panel is open. A refetch already in flight would
      // resolve after this write and put every row back as it was a second ago.
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      setUnread(queryClient, notificationIds, false);
    },

    onSuccess: (outcome) => {
      setUnread(queryClient, outcome.failed, true);
    },

    // No `onError`: `dismissEachNotification` reports refusals instead of rejecting.
    // An unexpected throw is still covered — this reconciles from the server either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  return {
    dismiss: (notificationIds) => {
      dismissal.mutate(notificationIds);
    },
    pending: dismissal.isPending,
    // Zeroed while another batch runs, so the message names the attempt on screen
    // rather than the previous one.
    refusedCount: dismissal.isPending ? 0 : (dismissal.data?.failed.length ?? 0),
  };
}
