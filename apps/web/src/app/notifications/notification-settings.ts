import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { NotificationKind, NotificationSettings } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';

/**
 * The one cache entry the settings control reads and its flips write.
 *
 * Exported for the same reason `NOTIFICATIONS_QUERY_KEY` is: the optimistic write below
 * must land in the cache the switches render from, and two literals would let them
 * drift apart.
 */
export const NOTIFICATION_SETTINGS_QUERY_KEY = ['notifications', 'settings'] as const;

/** What the settings control renders and flips. */
export interface NotificationSettingsControls {
  /** The server's list, or `null` until the first read lands. */
  readonly settings: NotificationSettings | null;
  /** True while the first read is still out — the control shows nothing conclusive. */
  readonly loading: boolean;
  /** Move one switch. Optimistic; the server's answer reconciles. */
  setEnabled(kind: NotificationKind, enabled: boolean): void;
}

/**
 * The per-kind notification switches, bound to `notifications.settings.*` (issue #209).
 *
 * ⚠ **Fetched only while `open`** — the panel mounts this hook behind a disclosure
 * toggle, and a person who never opens it should cost no request. The cache persists
 * across openings, so a second open paints from what the first one learned.
 *
 * **Optimistic, because a switch that waits a round trip to move reads as broken.**
 * The flip lands in the cache on the tap; `onSettled` reconciles from the server, so
 * what the switches finally show is always the server's answer — including on failure,
 * where the switch visibly snaps back rather than lying.
 *
 * Online-only, like `notifications.dismiss` and for the same reason:
 * `notification.settings.update` is deliberately absent from `MUTATION_TYPES`, so
 * ADR-0005's conflict matrix does not define it and the offline queue would replay it
 * as `rejected` / `UNSUPPORTED_MUTATION_TYPE`. A preference flipped offline and
 * silently dropped is worse than a switch that needs a connection.
 */
export function useNotificationSettings(open: boolean): NotificationSettingsControls {
  const api = useApi();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: NOTIFICATION_SETTINGS_QUERY_KEY,
    queryFn: () => api.query('notifications.settings.get', undefined),
    enabled: open,
  });

  const update = useMutation({
    mutationFn: (input: { kind: NotificationKind; enabled: boolean }) =>
      api.mutate('notifications.settings.update', input),

    onMutate: async (input) => {
      // The read is not polling, but a refetch triggered by a previous flip's
      // `onSettled` could still be in flight and land on top of this write.
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_SETTINGS_QUERY_KEY });
      queryClient.setQueryData<NotificationSettings>(NOTIFICATION_SETTINGS_QUERY_KEY, (current) =>
        current === undefined
          ? current
          : {
              settings: current.settings.map((setting) =>
                setting.kind === input.kind ? { ...setting, enabled: input.enabled } : setting,
              ),
            },
      );
    },

    // The mutation's answer IS the full list, but writing it directly would race a
    // second flip's optimistic write; invalidating lets the cache converge on one
    // server read instead.
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_QUERY_KEY }),
  });

  return {
    settings: settings.data ?? null,
    loading: open && settings.data === undefined,
    setEnabled: (kind, enabled) => {
      update.mutate({ kind, enabled });
    },
  };
}
