import { describe, expect, it } from 'vitest';

import { createListDismissedBulletinsQuery } from '../../application/list-dismissed-bulletins.query';
import type { VisibleBulletin } from '../../application/visible-bulletin';
import {
  BOARD_PAGE_SIZE,
  type VisibleBulletinsRepository,
} from '../../application/visible-bulletins.repository';

/**
 * `specs/features/moderation-report-dismiss.feature` — the Dismissed category's own
 * decisions, at the level they are actually made (#170).
 *
 * Three of them, and none needs a database: the order the category reads in, what happens
 * to a dismissed bulletin the viewer may no longer see, and the page bound the identifier
 * read is given. Fakes rather than mocks — an in-memory repository and an in-memory
 * dismissal list — so every assertion is over the page that came back rather than over
 * which methods were called in which order.
 *
 * The behaviour these cover is *not* re-asserted in
 * `dismissed-category.integration.test.ts`; that suite proves the SQL and the
 * cross-module wiring, this one proves the composition rule, and duplicating either into
 * the other would make one of them the slow copy.
 */
describe('the Dismissed category composes dismissal order with the authorized read', () => {
  function aBulletin(id: string, createdAt: string): VisibleBulletin {
    return {
      id,
      type: 'offer',
      title: `Bulletin ${id}`,
      body: 'Body.',
      createdAt: new Date(createdAt),
      loc: null,
      expiresAt: null,
      version: 1,
      author: { userId: 'author-1', disclosure: 'full', displayName: 'Author' },
    };
  }

  /**
   * An authorized read that knows about `authorized` and nothing else.
   *
   * ⚠ It answers in **ascending id order regardless of what it was asked for**, on
   * purpose: the real repository promises no order, so a fake that echoed the request
   * order back would let a query that forgot to re-order pass anyway.
   */
  function visibleBulletinsOf(authorized: readonly VisibleBulletin[]): VisibleBulletinsRepository {
    return {
      findVisibleById: () => Promise.resolve(null),
      findVisible: () => Promise.resolve([]),
      findVisibleByIds: (_viewerId, bulletinIds) =>
        Promise.resolve(
          [...authorized.filter((bulletin) => bulletinIds.includes(bulletin.id))].sort(
            (left, right) => left.id.localeCompare(right.id),
          ),
        ),
    };
  }

  it('lists most-recently-dismissed first, whatever order the authorized read answered in', async () => {
    // Posted oldest-first as c, b, a; dismissed in the order a, then c, then b. The
    // category is a record of the viewer's own decisions, so it reads b, c, a.
    const authorized = [
      aBulletin('a', '2026-08-01T00:00:00.000Z'),
      aBulletin('b', '2026-08-02T00:00:00.000Z'),
      aBulletin('c', '2026-08-03T00:00:00.000Z'),
    ];

    const page = await createListDismissedBulletinsQuery({
      bulletins: visibleBulletinsOf(authorized),
      dismissedBulletins: { findDismissedFor: () => Promise.resolve(['b', 'c', 'a']) },
    }).list({ viewerId: 'viewer-1' });

    expect(page.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('drops a dismissed bulletin the viewer may no longer see, and keeps the rest in order', async () => {
    // `gone` was dismissed and has since been archived by its author, so the authorized
    // read does not return it. The category shows what it can show rather than a hole.
    const page = await createListDismissedBulletinsQuery({
      bulletins: visibleBulletinsOf([
        aBulletin('kept-1', '2026-08-01T00:00:00.000Z'),
        aBulletin('kept-2', '2026-08-02T00:00:00.000Z'),
      ]),
      dismissedBulletins: {
        findDismissedFor: () => Promise.resolve(['kept-2', 'gone', 'kept-1']),
      },
    }).list({ viewerId: 'viewer-1' });

    expect(page.items.map((item) => item.id)).toEqual(['kept-2', 'kept-1']);
  });

  it('bounds the identifier read by the board page size rather than a second constant', async () => {
    let requestedLimit: number | null = null;

    await createListDismissedBulletinsQuery({
      bulletins: visibleBulletinsOf([]),
      dismissedBulletins: {
        findDismissedFor: (_viewerId, limit) => {
          requestedLimit = limit;

          return Promise.resolve([]);
        },
      },
    }).list({ viewerId: 'viewer-1' });

    expect(requestedLimit).toBe(BOARD_PAGE_SIZE);
  });

  it('answers an empty page for a viewer who has dismissed nothing', async () => {
    const page = await createListDismissedBulletinsQuery({
      bulletins: visibleBulletinsOf([aBulletin('never-dismissed', '2026-08-01T00:00:00.000Z')]),
      dismissedBulletins: { findDismissedFor: () => Promise.resolve([]) },
    }).list({ viewerId: 'viewer-1' });

    expect(page.items).toEqual([]);
  });
});
