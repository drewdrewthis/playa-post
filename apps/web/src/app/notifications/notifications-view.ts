import type { GroupedNotification } from '@playa-post/contracts';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The notifications still waiting on the reader — the panel's main section.
 *
 * ⚠ **Not the whole list.** `notifications.list` keeps a dismissed notification and
 * marks it `unread: false`, so that a client can see its dismissal land rather than
 * infer it from an absence. Rendering the raw list would put every already-dealt-with
 * item back in front of the reader.
 */
export function unreadNotifications(
  notifications: readonly GroupedNotification[],
): readonly GroupedNotification[] {
  return notifications.filter((notification) => notification.unread);
}

/** The notifications already dealt with — the panel's history section. */
export function dismissedNotifications(
  notifications: readonly GroupedNotification[],
): readonly GroupedNotification[] {
  return notifications.filter((notification) => !notification.unread);
}

/**
 * What the bell's badge shows.
 *
 * ⚠ **Counts `unread`, never `list.length`.** Dismissed notifications stay in the list,
 * so a length-based badge would never fall back to zero once anything had ever arrived.
 */
export function unreadNotificationCount(
  notifications: readonly GroupedNotification[],
): number {
  return unreadNotifications(notifications).length;
}

/**
 * A notification's title line — the comp's serif row heading.
 *
 * The contract serves *ids* and no text (M2-AC5: resolving one is a separate,
 * visibility-checked read), so the title says what the notification is rather than
 * quoting what caused it. For a Notify Me group the count is the one real fact grouping
 * produces; for a note there is nothing to count.
 *
 * ⚠ **"Someone", not a name.** A note notification carries no author — deliberately, and
 * the copy has to survive that: naming the writer here would mean the contract carrying
 * an identity the graph may since have withdrawn (§6a), for a line nobody needs it in.
 * Who pinned it is answered on the board, where the author card is projected.
 */
export function notificationTitle(notification: GroupedNotification): string {
  if (notification.kind === 'note') {
    return 'Someone pinned a note to your board';
  }

  return notification.bulletinIds.length === 1
    ? 'A new bulletin matches your Notify Me query'
    : `${notification.bulletinIds.length} new bulletins match your Notify Me query`;
}

/**
 * How long ago something happened, in the comp's units — "just now", "5m ago", "2h
 * ago", "3d ago".
 *
 * ⚠ **A future or unreadable `occurredAt` reads as "just now".** The server stamps the
 * timestamp and the browser reads the clock; a device running a few minutes slow would
 * otherwise render "-3m ago", which looks like a bug in the product rather than a
 * disagreement between two clocks.
 *
 * @param occurredAt - ISO-8601, as every timestamp this API serves.
 * @param now - the reading clock, passed in so the formatting stays testable.
 */
export function relativeTime(occurredAt: string, now: Date): string {
  const elapsed = now.getTime() - new Date(occurredAt).getTime();

  if (!Number.isFinite(elapsed) || elapsed < MILLISECONDS_PER_MINUTE) {
    return 'just now';
  }

  if (elapsed < MILLISECONDS_PER_HOUR) {
    return `${Math.floor(elapsed / MILLISECONDS_PER_MINUTE)}m ago`;
  }

  if (elapsed < MILLISECONDS_PER_DAY) {
    return `${Math.floor(elapsed / MILLISECONDS_PER_HOUR)}h ago`;
  }

  return `${Math.floor(elapsed / MILLISECONDS_PER_DAY)}d ago`;
}
