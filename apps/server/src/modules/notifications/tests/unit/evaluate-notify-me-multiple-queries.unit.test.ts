import { describe, expect, it } from 'vitest';

import type { NotifyMeQueryDirectory, SavedNotifyMeQuery } from '../../../views/views.module';
import { createEvaluateNotifyMeHandler } from '../../application/evaluate-notify-me.handler';
import type {
  AuthorizedMatchQuery,
  CompleteWindowCommand,
  EligibleRecipientsQuery,
  NotifyMeMatchRepository,
  RecordMatchesCommand,
} from '../../application/notify-me-match.repository';
import type { OutboxEventRow } from '../../application/outbox-consumer';
import { BULLETIN_CREATED, NOTIFY_ME_MATCHED } from '../../domain/notification.events';
import type { NotifyMeMatch } from '../../domain/notify-me-match';

/**
 * `EvaluateNotifyMeHandler`'s arithmetic under ADR-0020's default-on semantics: every
 * eligible recipient is a candidate, a stored query only narrows, and a person is
 * matched at most once per bulletin whatever the directory hands back.
 *
 * ⚠ **Unit rather than integration, because the claims are about arithmetic on lists.**
 * "A queryless candidate matches outright", "one match per person however many of their
 * queries match" — statements about what this handler *counts*, and the cheapest honest
 * way to see them is to hand it a fixed eligible list and directory and read what it
 * hands to `recordMatches`. The authorized-read half — who is actually eligible, what
 * actually matches — is `notify-me-push.integration.test.ts`'s and stays there; a fake
 * here would prove nothing about `app.visible_bulletins`, so this file does not pretend to.
 *
 * The doubles are fakes rather than mocks: an in-memory directory and a repository that
 * records what it was told, asserted on the artifact (the matches) rather than on a call
 * sequence (`references/principles/coding.md`).
 */
describe('EvaluateNotifyMeHandler under default-on', () => {
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
   * A repository that answers eligibility from a fixed list, matching from a set of
   * texts, and remembers what it was told.
   *
   * `eligible` is what the SQL would have answered — visible, author excluded, opt-outs
   * excluded — and `matching` names the query texts that count as a match, so a test
   * can say "this person's first row misses and their second hits" without a database.
   */
  function fakeMatches(
    eligible: readonly string[],
    matching: ReadonlySet<string>,
  ): NotifyMeMatchRepository & {
    readonly asked: AuthorizedMatchQuery[];
    readonly recorded: RecordMatchesCommand[];
  } {
    const asked: AuthorizedMatchQuery[] = [];
    const recorded: RecordMatchesCommand[] = [];

    return {
      asked,
      recorded,
      async findEligibleRecipients(_query: EligibleRecipientsQuery): Promise<readonly string[]> {
        return eligible;
      },
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

  it('matches a queryless eligible recipient outright, at no authorized-read cost', async () => {
    // ADR-0020 D2: no stored query narrows nothing. Eligibility already established
    // visibility, so nothing further is asked.
    const matches = fakeMatches([reader], new Set());
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked).toHaveLength(0);
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

  it('drops an eligible recipient whose only query does not match — a query narrows', async () => {
    const matches = fakeMatches([reader], new Set(['shade']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([savedQuery(reader, 'truck')]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.recorded[0]?.matches).toEqual([]);
  });

  it('never matches a person the eligibility read excluded, whatever their queries say', async () => {
    // An opted-out or no-longer-visible person is simply absent from the eligible list.
    // Their directory rows must cost nothing and produce nothing.
    const matches = fakeMatches([other], new Set(['truck']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([savedQuery(reader, 'truck')]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked).toHaveLength(0);
    expect(matches.recorded[0]?.matches.map((each) => each.recipientId)).toEqual([other]);
  });

  it('matches a person once when two of their queries match the same bulletin', async () => {
    // ⚠ The regression a duplicate directory row makes possible: two rows for one
    // person, both matching. A `NotifyMeMatched` each would put this bulletin into their
    // grouping window twice and push it at them twice.
    const matches = fakeMatches([reader], new Set(['truck', 'kitchen']));
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
    // The other half of the same property: a person who has matched costs one
    // authorized read, not one per row.
    const matches = fakeMatches([reader], new Set(['truck']));
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

  it('evaluates every query of a person whose last query is the one that matches', async () => {
    // Nothing may be skipped here: a person whose third row is the one that matches
    // must still be found.
    const matches = fakeMatches([reader], new Set(['shade']));
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
    const matches = fakeMatches([reader, other], new Set(['truck', 'shade']));
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

  it('never matches the author, even if the eligibility read wrongly served them', async () => {
    // The SQL excludes the author; the handler settles them besides, so a repository
    // bug cannot become a self-notification. Their queries cost nothing.
    const matches = fakeMatches([author, reader], new Set(['truck', 'kitchen']));
    const handler = createEvaluateNotifyMeHandler({
      notifyMeQueries: directory([savedQuery(author, 'truck'), savedQuery(author, 'kitchen')]),
      matches,
    });

    await handler.handle(bulletinCreated);

    expect(matches.asked).toHaveLength(0);
    expect(matches.recorded[0]?.matches.map((each) => each.recipientId)).toEqual([reader]);
  });
});
