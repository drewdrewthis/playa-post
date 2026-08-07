import { useQuery } from '@tanstack/react-query';

import type { GroupedNotification } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';

/**
 * The caller's own grouped Notify Me notifications, newest first.
 *
 * Shared by the bell (which needs the count) and the panel (which needs the items) so
 * the two cannot disagree about what is unread; React Query dedupes them into one
 * request by key.
 *
 * ⚠ **The query runs whether or not the panel is open**, which is what makes the bell's
 * count real rather than "whatever we saw the last time you looked". It polls only
 * while open: the grouping-window flush (ADR-0006) delivers on the server's schedule,
 * so a panel opened moments after a matching bulletin would otherwise sit on "All
 * quiet" until a remount.
 *
 * @param polling - whether the panel is open and the fast refresh is wanted.
 */
export function useGroupedNotifications(polling: boolean): readonly GroupedNotification[] {
  const api = useApi();

  const notifications = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.query('notifications.list', undefined),
    refetchInterval: polling ? 1000 : false,
  });

  return notifications.data ?? [];
}
