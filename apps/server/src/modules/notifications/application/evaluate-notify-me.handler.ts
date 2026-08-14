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
  /** `modules/views`' stored-query reader — never a read of its table from here. */
  readonly notifyMeQueries: NotifyMeQueryDirectory;
  readonly matches: NotifyMeMatchRepository;
  /** Reads the wall clock. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/** This module's `BulletinCreated` consumer. */
export type EvaluateNotifyMeHandler = OutboxConsumer;

/**
 * Compute who a newly created bulletin notifies (M2.10, reshaped by ADR-0020).
 *
 * **Default-on: everyone who can see the bulletin is a candidate** (issue #209). The
 * repository enumerates the candidates — visible per `app.visible_bulletins`, author
 * excluded, `bulletins` opt-outs excluded — and a stored Notify Me query then acts as
 * a **narrowing filter**: a candidate with no current query matches outright, and a
 * candidate with one matches only if it does. A person whose stored query the
 * directory no longer serves (a stale `ast_version`) is treated as queryless and
 * notified — ADR-0020 D2's accepted edge, until ADR-0007's re-validation runs.
 *
 * **It computes matches; it does not deliver them.** Each match is written to the
 * outbox as a `NotifyMeMatched` row, and
 * {@link import('./send-grouped-push.handler').SendGroupedPushHandler} flushes those
 * on the grouping window (ADR-0006's "notification grouping window flush"). Splitting
 * compute from delivery is what makes the 60-second window expressible at all, and it
 * is what lets ADR-0002 §11's re-check happen at *send* time rather than here.
 *
 * **Authorization is not assumed from the event.** The payload carries identifiers
 * only (ADR-0006), so eligibility is read **as each candidate recipient**, through
 * `app.visible_bulletins` — the one definition of what a viewer may see. A recipient
 * who cannot see the bulletin is never a candidate even though their filter would
 * have matched its text, and no layer here has to remember to check.
 *
 * **Idempotent by receipt** (M2-AC8). The receipt for the triggering event is written
 * in the same transaction as the matches, so a redelivered `BulletinCreated` writes
 * nothing a second time. That is `recordMatches`' job — this handler does not track
 * what it has seen.
 *
 * ⚠ **One match per person per bulletin, however many rows the directory hands back for
 * them.** `unique (owner_id)` holds a person to one stored query (#208, ADR-0019), but
 * this handler does not lean on that: a `NotifyMeMatched` per row would put the same
 * bulletin into somebody's grouping window several times, and `recordMatches` writes what
 * it is given — the window that groups them cannot tell a genuine second bulletin from
 * the same one counted twice. Deduplication stays here because this is the layer that
 * knows a person is a person: a candidate settles at their first matching query and is
 * never tested again.
 *
 * The author is excluded in the eligibility SQL, and settled here besides: a push
 * telling somebody about their own bulletin is noise, and they are the one person
 * guaranteed to already know.
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

      // ADR-0020 D1's candidate set: visible, not the author, not opted out.
      const eligible = await dependencies.matches.findEligibleRecipients({
        bulletinId: event.aggregateId,
        authorId,
      });

      // Each candidate's stored queries, so "has no query" is answerable per person.
      // The directory serves current-grammar rows only, so a stale-AST owner appears
      // queryless here and matches outright (ADR-0020 D2's accepted edge).
      const stored = await dependencies.notifyMeQueries.findAllCurrent();
      const queriesByOwner = new Map<string, (typeof stored)[number]['query'][]>();
      for (const { ownerId, query } of stored) {
        const theirs = queriesByOwner.get(ownerId);
        if (theirs === undefined) {
          queriesByOwner.set(ownerId, [query]);
        } else {
          theirs.push(query);
        }
      }

      const matched: NotifyMeMatched[] = [];
      // Whose result is already settled. The eligibility SQL excludes the author, but a
      // directory row of theirs must still never turn into a self-notification.
      const settled = new Set<string>([authorId]);

      for (const recipientId of eligible) {
        if (settled.has(recipientId)) {
          continue;
        }

        const queries = queriesByOwner.get(recipientId) ?? [];
        // No stored query narrows nothing: eligibility already established visibility,
        // so a queryless candidate matches outright (ADR-0020 D2).
        let isMatch = queries.length === 0;

        // Sequential on purpose: one authorized read per evaluated stored query, and
        // firing them all at once would let one bulletin open as many pool connections
        // as the product has switched-on Notify Me queries. The scan settles at the
        // first query that matches.
        for (const query of queries) {
          if (isMatch) {
            break;
          }
          isMatch = await dependencies.matches.isAuthorizedMatch({
            recipientId,
            bulletinId: event.aggregateId,
            query,
          });
        }

        if (isMatch) {
          settled.add(recipientId);
          matched.push({
            type: NOTIFY_ME_MATCHED,
            occurredAt: event.occurredAt,
            recipientId,
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
