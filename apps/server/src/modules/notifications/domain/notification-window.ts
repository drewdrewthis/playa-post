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

/**
 * The minimum a match must carry to be grouped.
 *
 * ⚠ **Two fields, and deliberately not {@link NotifyMeMatch}.** The rule below reads
 * *when* a match happened and *whose* it is; nothing else changes a window boundary.
 * Demanding the whole match would force the read path — which reports windows the flush
 * already produced, and needs no `authorId` because it re-checks the *bulletin* rather
 * than its author — to carry a field it would have to invent.
 */
export interface GroupableMatch {
  readonly recipientId: string;
  /** The triggering bulletin's `occurred_at` — what the window is measured over. */
  readonly occurredAt: Date;
}

/** One recipient's group of matches, and the interval they were grouped over. */
export interface NotificationWindow<TMatch extends GroupableMatch = NotifyMeMatch> {
  readonly recipientId: string;
  /** The `occurredAt` of the match that opened it. */
  readonly startsAt: Date;
  /** `startsAt` + {@link NOTIFICATION_WINDOW_MS}. Exclusive. */
  readonly endsAt: Date;
  /** Oldest first. Never empty — a window exists because a match opened it. */
  readonly matches: readonly TMatch[];
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
 * ⚠ **One rule, two callers.** The grouped-push flush groups *pending* matches before
 * sending; `ListNotificationsQuery` groups *already-flushed* ones to report what was
 * sent. They must agree, so the read path calls this function rather than re-deriving
 * the window — a second grouping rule would show a person a grouping their device never
 * received, and only one of the two would be covered by M2-AC7's boundary scenarios.
 *
 * @param matches - Matches in any order; this function sorts.
 * @returns Windows in ascending start order per recipient. A window whose `endsAt` is
 *   still in the future is **included** — deciding whether it has elapsed is the
 *   caller's job, because "now" is a dependency and this function has none.
 */
export function groupIntoNotificationWindows<TMatch extends GroupableMatch>(
  matches: readonly TMatch[],
): readonly NotificationWindow<TMatch>[] {
  const byRecipient = new Map<string, TMatch[]>();

  for (const match of [...matches].sort(byOccurredAt)) {
    const existing = byRecipient.get(match.recipientId);
    if (existing === undefined) {
      byRecipient.set(match.recipientId, [match]);
    } else {
      existing.push(match);
    }
  }

  const windows: NotificationWindow<TMatch>[] = [];

  for (const [recipientId, ordered] of byRecipient) {
    let startsAt: Date | undefined;
    let grouped: TMatch[] = [];

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

function byOccurredAt(left: GroupableMatch, right: GroupableMatch): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime();
}

function endOf(startsAt: Date): number {
  return startsAt.getTime() + NOTIFICATION_WINDOW_MS;
}

function closeWindow<TMatch extends GroupableMatch>(
  recipientId: string,
  startsAt: Date,
  matches: readonly TMatch[],
): NotificationWindow<TMatch> {
  return { recipientId, startsAt, endsAt: new Date(endOf(startsAt)), matches };
}
