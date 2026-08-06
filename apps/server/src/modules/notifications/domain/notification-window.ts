import type { NotifyMeMatch } from './notify-me-match';

/**
 * The grouping window, in milliseconds — ADR-0006's "notification grouping window".
 *
 * 60 seconds, and **tumbling from the first match rather than sliding**: a window is a
 * fixed `[start, start + 60s)` interval that a later match either falls inside or
 * starts a new one outside of. A session window that reset on every arrival could be
 * held open indefinitely by a steady trickle of bulletins, which is the opposite of
 * what grouping is for.
 *
 * Both boundary scenarios in `notify-me.feature` are stated against this reading: a
 * second bulletin at t = 59 s joins the first window, one at t = 61 s starts a second.
 */
export const NOTIFICATION_WINDOW_MS = 60_000;

/** One recipient's group of matches, and the interval they were grouped over. */
export interface NotificationWindow {
  readonly recipientId: string;
  /** The `occurredAt` of the match that opened it. */
  readonly startsAt: Date;
  /** `startsAt` + {@link NOTIFICATION_WINDOW_MS}. Exclusive. */
  readonly endsAt: Date;
  /** Oldest first. Never empty — a window exists because a match opened it. */
  readonly matches: readonly NotifyMeMatch[];
}

/**
 * Group pending matches into tumbling per-recipient windows.
 *
 * **Pure, and deliberately in `domain/`**: "which bulletins arrive as one
 * notification" is the product rule M2-AC7 states, not a detail of how rows are
 * stored, and keeping it out of SQL is what lets both boundary scenarios be checked
 * without a database in the loop.
 *
 * Recipients are independent: one person's quiet hour cannot pull another person's
 * bulletins into a different group.
 *
 * @param matches - Pending matches in any order; this function sorts.
 * @returns Windows in ascending start order per recipient. A window whose `endsAt` is
 *   still in the future is **included** — deciding whether it has elapsed is the
 *   caller's job, because "now" is a dependency and this function has none.
 */
export function groupIntoNotificationWindows(
  matches: readonly NotifyMeMatch[],
): readonly NotificationWindow[] {
  const byRecipient = new Map<string, NotifyMeMatch[]>();

  for (const match of [...matches].sort(byOccurredAt)) {
    const existing = byRecipient.get(match.recipientId);
    if (existing === undefined) {
      byRecipient.set(match.recipientId, [match]);
    } else {
      existing.push(match);
    }
  }

  const windows: NotificationWindow[] = [];

  for (const [recipientId, ordered] of byRecipient) {
    let startsAt: Date | undefined;
    let grouped: NotifyMeMatch[] = [];

    for (const match of ordered) {
      if (startsAt !== undefined && match.occurredAt.getTime() < endOf(startsAt)) {
        grouped.push(match);
        continue;
      }

      if (startsAt !== undefined) {
        windows.push(closeWindow(recipientId, startsAt, grouped));
      }
      startsAt = match.occurredAt;
      grouped = [match];
    }

    if (startsAt !== undefined) {
      windows.push(closeWindow(recipientId, startsAt, grouped));
    }
  }

  return windows;
}

function byOccurredAt(left: NotifyMeMatch, right: NotifyMeMatch): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime();
}

function endOf(startsAt: Date): number {
  return startsAt.getTime() + NOTIFICATION_WINDOW_MS;
}

function closeWindow(
  recipientId: string,
  startsAt: Date,
  matches: readonly NotifyMeMatch[],
): NotificationWindow {
  return { recipientId, startsAt, endsAt: new Date(endOf(startsAt)), matches };
}
