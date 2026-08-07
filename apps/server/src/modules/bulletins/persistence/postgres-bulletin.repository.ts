import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import type { BoardQuery } from '../../views/views.module';
import type { VisibleBulletin } from '../application/visible-bulletin';
import {
  BOARD_PAGE_SIZE,
  type VisibleBulletinsRepository,
} from '../application/visible-bulletins.repository';
import type { Bulletin } from '../domain/bulletin';
import { BulletinGoneError } from '../domain/bulletin.errors';
import {
  BULLETIN_CREATED,
  bulletinArchived,
  bulletinCreated,
  type BulletinArchived,
  type BulletinCreated,
} from '../domain/bulletin.events';
import type {
  ArchiveBulletinWrite,
  ArchivedBulletin,
  BulletinRepository,
  NewBulletin,
} from '../domain/bulletin.repository';

import { compileBoardFilter } from './board-filter';
import { toBulletin } from './bulletin.mapper';
import { toVisibleBulletin, type VisibleBulletinRow } from './visible-bulletin.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresBulletinRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The projection every read of `app.visible_bulletins` selects.
 *
 * Named columns rather than `select *`: the function also returns `search_document`,
 * which the board's `WHERE` needs and no caller above this file should receive.
 * Written once so the two reads cannot drift into two shapes for
 * {@link VisibleBulletinRow} to be right about only one of.
 */
const VISIBLE_BULLETIN_COLUMNS = sql`
  bulletin_id, author_id, type, title, body, created_at, loc, expires_at, version,
  author_disclosure, author_display_name, author_handle
`;

/**
 * `app.bulletins` and `app.visible_bulletins`, behind both of this module's ports.
 *
 * One object implementing two interfaces, because they describe two *questions* rather
 * than two stores: {@link BulletinRepository} is the author's own rows and
 * {@link VisibleBulletinsRepository} is the §6a-projected authorized set. Consumers
 * declare whichever they need, so a service that only creates cannot reach a board
 * read, and a board read cannot reach an unprojected row.
 *
 * Every statement is schema-qualified (`app.bulletins`, never `bulletins`) per
 * ADR-0002's pooler-safety rules: with `search_path` outside this file's control, an
 * unqualified name is a silent cross-schema read waiting for a `public.bulletins` to
 * exist.
 *
 * ⚠ This file also writes `app.outbox_events`, which is not a layering slip: a state
 * change and its event are **one transactional fact** (addendum §10, ADR-0006), and a
 * port per table would make the atomicity a convention two services have to remember
 * rather than a guarantee the database enforces.
 */
export function createPostgresBulletinRepository(
  dependencies: PostgresBulletinRepositoryDependencies,
): BulletinRepository & VisibleBulletinsRepository {
  const { database } = dependencies;

  return {
    async add(write: NewBulletin): Promise<Bulletin> {
      return database.transaction().execute(async (transaction) => {
        const inserted = await transaction
          .insertInto('app.bulletins')
          .values({
            author_id: write.authorId,
            type: write.type,
            title: write.title,
            body: write.body,
            loc: write.loc,
            expires_at: write.expiresAt,
            created_at: write.createdAt,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        const bulletin = toBulletin(inserted);
        await appendOutboxEvent(transaction, bulletinCreated(bulletin));

        return bulletin;
      });
    },

    async archive(write: ArchiveBulletinWrite): Promise<ArchivedBulletin> {
      return database.transaction().execute(async (transaction) => {
        // Authorship and liveness are part of the `where`, not of a prior read. A
        // read-then-write would leave a window an unrelated actor could not exploit
        // but a concurrent archive could, and it would also make actorship a step a
        // future editor can reorder — ADR-0005 precedence rule 1 says it must come
        // first, so it is expressed where it cannot be moved.
        const archived = await transaction
          .updateTable('app.bulletins')
          .set({
            archived_at: write.occurredAt,
            // Bumping the version on archive means an M5 `bulletin.update` carrying a
            // pre-archive version conflicts instead of resurrecting an archived
            // bulletin (ADR-0005 precedence rule 5).
            version: sql<number>`version + 1`,
          })
          .where('id', '=', write.bulletinId)
          .where('author_id', '=', write.actorId)
          .where('archived_at', 'is', null)
          .returningAll()
          .executeTakeFirst();

        if (archived === undefined) {
          // Nothing was updated, for one of two reasons. Re-read under the *same*
          // authorship predicate: if this actor has no such bulletin at all, they get
          // the answer a never-existent ID gets; if they do, it was already archived
          // and the call is a converging replay (ADR-0005's matrix).
          const existing = await transaction
            .selectFrom('app.bulletins')
            .selectAll()
            .where('id', '=', write.bulletinId)
            .where('author_id', '=', write.actorId)
            .executeTakeFirst();

          if (existing === undefined) {
            throw new BulletinGoneError();
          }

          // No second event and no second write: the state already holds, so no new
          // fact occurred and no consumer should be told one did (M2-AC12).
          return { bulletin: toBulletin(existing), event: null };
        }

        const bulletin = toBulletin(archived);
        const event = bulletinArchived(bulletin);
        await appendOutboxEvent(transaction, event);

        return { bulletin, event };
      });
    },

    async findByAuthor(authorId: string): Promise<readonly Bulletin[]> {
      const rows = await database
        .selectFrom('app.bulletins')
        .selectAll()
        .where('author_id', '=', authorId)
        // Archived rows are included on purpose — this is the author's retention view,
        // the one place an archived bulletin survives (M2-AC12).
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();

      return rows.map(toBulletin);
    },

    async findVisibleById(viewerId: string, bulletinId: string): Promise<VisibleBulletin | null> {
      // `viewerId` travels as a bound parameter, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      const { rows } = await sql<VisibleBulletinRow>`
        select ${VISIBLE_BULLETIN_COLUMNS}
          from app.visible_bulletins(${viewerId})
         where bulletin_id = ${bulletinId}
      `.execute(database);

      const row = rows[0];

      return row === undefined ? null : toVisibleBulletin(row);
    },

    async findVisible(viewerId: string, query: BoardQuery): Promise<readonly VisibleBulletin[]> {
      // ADR-0007:91-94, verbatim in shape: the authorized set is a CTE, the compiled
      // filter is a `WHERE` over it, and the sort and limit come last. The filter can
      // only ever remove rows `authorized` produced — B10.
      const { rows } = await sql<VisibleBulletinRow>`
        with authorized as (
          select * from app.visible_bulletins(${viewerId})
        )
        select ${VISIBLE_BULLETIN_COLUMNS}
          from authorized
         where ${compileBoardFilter(query)}
         order by created_at desc, bulletin_id desc
         limit ${BOARD_PAGE_SIZE}
      `.execute(database);

      return rows.map(toVisibleBulletin);
    },
  };
}

/**
 * Append one outbox row inside the caller's transaction.
 *
 * A local helper rather than a second port method: the outbox row rides the same
 * transaction as the change it describes, so it has no life of its own to expose.
 * Publishing to a queue from here instead is the dual-write bug — the commit succeeds,
 * the publish fails, and the two diverge with nothing left to reconcile them.
 */
async function appendOutboxEvent(
  transaction: DatabaseConnection,
  event: BulletinCreated | BulletinArchived,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and M2 adds no
      // dependency for one. v4 is a correct key — the ADR guarantees no ordering and
      // consumers must not assume any — and this is the one line that changes when a
      // v7 source arrives.
      event_id: randomUUID(),
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_id: event.authorId,
      aggregate_id: event.bulletinId,
      // Identifiers and routing data only. No title, no body: a consumer re-reads what
      // it needs through this module's authorized path, so a delivery can never carry
      // content the current visibility rules have since withdrawn (ADR-0006, PDF §6),
      // and no outbox row dumped into a log can carry bulletin text (M2-AC16).
      //
      // Passed as an object, not a `JSON.stringify`d string: the generated type for a
      // `jsonb` column is `Json`, so a string type-checks and stores a JSON *scalar*
      // that every consumer would then have to parse twice.
      payload: {
        bulletinId: event.bulletinId,
        authorId: event.authorId,
        ...(event.type === BULLETIN_CREATED ? { bulletinType: event.bulletinType } : {}),
      },
    })
    .execute();
}
