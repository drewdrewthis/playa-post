import { describe, expect, it } from 'vitest';

import type { NotifyMeQueryDirectory, SavedNotifyMeQuery } from '../../../views/views.module';
import { createEvaluateNotifyMeHandler } from '../../application/evaluate-notify-me.handler';
import type {
  AuthorizedMatchQuery,
  CompleteWindowCommand,
  NotifyMeMatchRepository,
  RecordMatchesCommand,
} from '../../application/notify-me-match.repository';
import type { OutboxEventRow } from '../../application/outbox-consumer';
import { BULLETIN_CREATED, NOTIFY_ME_MATCHED } from '../../domain/notification.events';
import type { NotifyMeMatch } from '../../domain/notify-me-match';

/**
 * What `EvaluateNotifyMeHandler` does now that one person may have several saved queries
 * (issue #172, decision D16).
 *
 * ⚠ **Unit rather than integration, because the claim is about arithmetic on a list.**
 * "One match per person however many of their queries match" is a statement about what
 * this handler *counts*, and the cheapest honest way to see it is to hand it a directory
 * with two matching queries for one owner and read what it hands to `recordMatches`. The
 * authorized-read half is `notify-me-push.integration.test.ts`'s and stays there — a fake
 * here would prove nothing about `app.visible_bulletins`, so this file does not pretend to.
 *
 * The doubles are fakes rather than mocks: an in-memory directory and a repository that
 * records what it was told, asserted on the artifact (the matches) rather than on a call
 * sequence (`references/principles/coding.md`).
 */
describe('EvaluateNotifyMeHandler with several queries per person (#172, D16)', () => {
  const bulletinId = '11111111-1111-4111-8111-111111111111';
  const author = '22222222-2222-4222-8222-222222222222';
  const reader = '33333333-3333-4333-8333-333333333333';
  const other = '44444444-4444-4444-8444-444444444444';

  const bulletinCreated: OutboxEventRow = {
    eventId: '55555555-5555-4555-8555-555555555555',
    eventType: BULLETIN_CREATED,
    occurredAt: new Date('2026-08-12T10:00:00.000Z'),
    actorId: author,
    aggregateId: bulletinId,
    payload: { authorId: author },
  };

  /**
   * A repository that answers matching from a set of texts and remembers what it was told.
   *
   * `matching` names the query texts that count as a match, so a test can say "this
   * person's first bell misses and their second hits" without a database.
   */
  function fakeMatches(matching: ReadonlySet<string>): NotifyMeMatchRepository & {
    readonly asked: AuthorizedMatchQuery[];
    readonly recorded: RecordMatchesCommand[];
  } {
    const asked: AuthorizedMatchQuery[] = [];
    const recorded: RecordMatchesCommand[] = [];

    return {
      asked,
      recorded,
      async isAuthorizedMatch(command: AuthorizedMatchQuery): Promise<boolean> {
        asked.push(command);
        return command.query.text.some((term) => matching.has(term));
      },
      async recordMatches(command: RecordMatchesCommand): Promise<void> {
        recorded.push(command);
      },
      async findPendingMatches(): Promise<readonly NotifyMeMatch[]> {
        return [];
      },
      async completeWindow(_command: CompleteWindowCommand): Promise<void> {
        // Not on this handler's path: the flush is SendGroupedPushHandler's.
      },
    };
  }

  function directory(queries: readonly SavedNotifyMeQuery[]): NotifyMeQueryDirectory {
    return {
      async findAllCurrent(): Promise<readonly SavedNotifyMeQuery[]> {
        return queries;
      },
    };
  }

  function savedQuery(ownerId: string, term: string): SavedNotifyMeQuery {
    return { ownerId, query: { types: [], text: [term] } };
  }

  it('matches a person once when two of their queries match the same bulletin', async () => {
    // ⚠ The regression D16 makes possible: two rows for one person, both matching. A
    // `NotifyMeMatched` each would put this bulletin into their grouping window twice and
    // push it at them once per bell.
    const matches = fakeMatches(new Set(['truck', 'kitchen']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([savedQuery(reader, 'truck'), savedQuery(reader, 'kitchen')]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.recorded).toHaveLength(1);
    expect(matches.recorded[0]?.matches).toEqual([
      {
        type: NOTIFY_ME_MATCHED,
        occurredAt: bulletinCreated.occurredAt,
        recipientId: reader,
        bulletinId,
        authorId: author,
      },
    ]);
  });

  it('stops reading a person’s queries once one of them has matched', async () => {
    // The other half of the same decision, and the reason the cap can be as generous as it
    // is: a person whose bulletin matches costs one authorized read, not one per bell.
    const matches = fakeMatches(new Set(['truck']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([
        savedQuery(reader, 'truck'),
        savedQuery(reader, 'kitchen'),
        savedQuery(reader, 'shade'),
      ]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked.map((each) => each.query.text)).toEqual([['truck']]);
  });

  it('still evaluates every query of a person none of whose queries match', async () => {
    // The case the cap actually bounds. Nothing may be skipped here — a person whose third
    // bell is the one that matches must still be found.
    const matches = fakeMatches(new Set(['shade']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([
        savedQuery(reader, 'truck'),
        savedQuery(reader, 'kitchen'),
        savedQuery(reader, 'shade'),
      ]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked).toHaveLength(3);
    expect(matches.recorded[0]?.matches.map((each) => each.recipientId)).toEqual([reader]);
  });

  it('keeps people apart — one person matching does not settle another', async () => {
    const matches = fakeMatches(new Set(['truck', 'shade']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([
        savedQuery(reader, 'truck'),
        savedQuery(other, 'kitchen'),
        savedQuery(other, 'shade'),
      ]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.recorded[0]?.matches.map((each) => each.recipientId)).toEqual([reader, other]);
  });

  it('never matches the author, however many queries of theirs would have', async () => {
    // The author is settled before any read, so this also asserts they cost nothing.
    const matches = fakeMatches(new Set(['truck', 'kitchen']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([savedQuery(author, 'truck'), savedQuery(author, 'kitchen')]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked).toHaveLength(0);
    expect(matches.recorded[0]?.matches).toEqual([]);
  });
});
