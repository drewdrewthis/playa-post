import type { NotifyMeQueryDirectory } from '../../views/views.module';
import {
  BULLETIN_CREATED,
  NOTIFY_ME_MATCHED,
  type NotifyMeMatched,
} from '../domain/notification.events';

import type { NotifyMeMatchRepository } from './notify-me-match.repository';
import type { OutboxConsumer, OutboxEventRow } from './outbox-consumer';

/**
 * `app.consumer_receipts.consumer_name` for this consumer.
 *
 * ADR-0006 names it. ⚠ Stable: renaming it makes every past receipt invisible and
 * reprocesses every already-handled event once.
 */
export const EVALUATE_NOTIFY_ME_CONSUMER = 'EvaluateNotifyMeHandler';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface EvaluateNotifyMeDependencies {
  /** `modules/views`' saved-query reader — never a read of its table from here. */
  readonly notifyMeQueries: NotifyMeQueryDirectory;
  readonly matches: NotifyMeMatchRepository;
  /** Reads the wall clock. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/** This module's `BulletinCreated` consumer. */
export type EvaluateNotifyMeHandler = OutboxConsumer;

/**
 * Evaluate every saved Notify Me query against a newly created bulletin (M2.10).
 *
 * **It computes matches; it does not deliver them.** Each match is written to the
 * outbox as a `NotifyMeMatched` row, and
 * {@link import('./send-grouped-push.handler').SendGroupedPushHandler} flushes those
 * on the grouping window (ADR-0006's "notification grouping window flush"). Splitting
 * compute from delivery is what makes the 60-second window expressible at all, and it
 * is what lets ADR-0002 §11's re-check happen at *send* time rather than here.
 *
 * **Authorization is not assumed from the event.** The payload carries identifiers
 * only (ADR-0006), so this handler re-reads the bulletin **as each candidate
 * recipient**, through `app.visible_bulletins` — the one definition of what a viewer
 * may see. A recipient who cannot see the bulletin gets no match even though their
 * filter would have matched its text, and no layer here has to remember to check.
 *
 * **Idempotent by receipt** (M2-AC8). The receipt for the triggering event is written
 * in the same transaction as the matches, so a redelivered `BulletinCreated` writes
 * nothing a second time. That is `recordMatches`' job — this handler does not track
 * what it has seen.
 *
 * The author is skipped: a push telling somebody about their own bulletin is noise,
 * and they are the one person guaranteed to already know.
 */
export function createEvaluateNotifyMeHandler(
  dependencies: EvaluateNotifyMeDependencies,
): EvaluateNotifyMeHandler {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    name: EVALUATE_NOTIFY_ME_CONSUMER,

    async handle(event: OutboxEventRow): Promise<void> {
      // Returning rather than throwing for an event this consumer does not subscribe
      // to: a throw would push an irrelevant delivery through the retry-and-dead-letter
      // path (ADR-0006, M2-AC23) and eventually raise an alert about nothing.
      if (event.eventType !== BULLETIN_CREATED) {
        return;
      }

      const authorId = authorOf(event);
      if (authorId === null) {
        // An event with no author is malformed rather than unauthorized. There is
        // nobody to check reachability against, so there is no safe match to compute;
        // the receipt still lands below, which stops it being retried forever.
        await dependencies.matches.recordMatches({
          eventId: event.eventId,
          processedAt: readClock(),
          matches: [],
        });
        return;
      }

      const saved = await dependencies.notifyMeQueries.findAllCurrent();
      const matched: NotifyMeMatched[] = [];

      for (const { ownerId, query } of saved) {
        if (ownerId === authorId) {
          continue;
        }

        // Sequential on purpose: this is one authorized read per person who has saved
        // a query, and firing them all at once would let one bulletin open as many
        // pool connections as the product has Notify Me users.
        const isMatch = await dependencies.matches.isAuthorizedMatch({
          recipientId: ownerId,
          bulletinId: event.aggregateId,
          query,
        });

        if (isMatch) {
          matched.push({
            type: NOTIFY_ME_MATCHED,
            occurredAt: event.occurredAt,
            recipientId: ownerId,
            bulletinId: event.aggregateId,
            authorId,
          });
        }
      }

      await dependencies.matches.recordMatches({
        eventId: event.eventId,
        processedAt: readClock(),
        matches: matched,
      });
    },
  };
}

/**
 * The bulletin's author, from the payload, falling back to the envelope's `actor_id`.
 *
 * Both are written by `modules/bulletins` for a `BulletinCreated`. Reading the payload
 * first because that is the field the *publisher* documents as the author, and falling
 * back because ADR-0006's envelope makes `actor_id` "who caused it" — which for a
 * bulletin creation is the same person.
 */
function authorOf(event: OutboxEventRow): string | null {
  const fromPayload = event.payload['authorId'];
  return typeof fromPayload === 'string' ? fromPayload : event.actorId;
}
