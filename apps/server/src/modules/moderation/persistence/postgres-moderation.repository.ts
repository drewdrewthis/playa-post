import type { DatabaseConnection } from '@playa-post/database';

import type { HiddenBulletin } from '../domain/hidden-bulletin';
import type {
  HideBulletinWrite,
  ModerationRepository,
  ReportBulletinWrite,
} from '../domain/moderation.repository';
import type { RestoredBulletin } from '../domain/restored-bulletin';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresModerationRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.bulletin_reports` and `app.bulletin_dismissals`, behind
 * {@link ModerationRepository}.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules: with
 * `search_path` outside this file's control, an unqualified name is a silent
 * cross-schema read waiting for a `public.bulletin_reports` to exist.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, unlike `modules/bulletins`' and
 * `modules/connections`' repositories. That is not an omission — it is M2-AC10's
 * notifications clause: zero outbox rows means no delivery exists for a future consumer
 * to read the reporter's identity out of (B9). Adding an event here would break a
 * privacy guarantee from a file no privacy test looks at.
 *
 * ⚠ **No `select` here returns `reason` or `detail`.** They are written and never read
 * back: `detail` is reporter-authored free text that may name the reporter, and the
 * only sanctioned reader is the stewards' queue (M5), which does not exist yet. A
 * convenience `select *` added to `findHiddenFor` would put both on a code path the
 * board — and therefore an author's own request — travels (M2-AC10, B9).
 *
 * ⚠ **No statement here reads `app.bulletins` or `app.users`.** Whether the acting
 * viewer may see the bulletin at all is decided *before* this layer, through
 * `modules/bulletins`' authorized read
 * ({@link import('../application/find-visible-bulletin').FindVisibleBulletin}). A join
 * to either table here would be a second definition of "who can see what" that no gate
 * can see (ADR-0002 §6, R2).
 */
export function createPostgresModerationRepository(
  dependencies: PostgresModerationRepositoryDependencies,
): ModerationRepository {
  const { database } = dependencies;

  return {
    async report(write: ReportBulletinWrite): Promise<HiddenBulletin> {
      // `on conflict do nothing` rather than a read-then-write: ADR-0005's matrix makes
      // a second report of the same bulletin by the same reporter a converging no-op,
      // and expressing that as the unique constraint's own behaviour means two
      // concurrent reports cannot both decide there is no row yet.
      //
      // ⚠ `do nothing`, never `do update`: on a repeat the *first* reason and the first
      // account stay. They are what the reporter filed and what a steward may already
      // have read; an upsert would let a later re-report silently rewrite a statement
      // attributed to them.
      const inserted = await database
        .insertInto('app.bulletin_reports')
        .values({
          bulletin_id: write.bulletinId,
          reporter_id: write.viewerId,
          created_at: write.occurredAt,
          reason: write.reason,
          detail: write.detail,
        })
        .onConflict((onConflict) =>
          onConflict.columns(['bulletin_id', 'reporter_id']).doNothing(),
        )
        .returning('created_at')
        .executeTakeFirst();

      if (inserted !== undefined) {
        return { bulletinId: write.bulletinId, viewerId: write.viewerId, hiddenAt: inserted.created_at };
      }

      // Conflicted, so the pair is already recorded. Answer with the *original*
      // timestamp: idempotency means the second call returns the state the first one
      // established, not a fresh one that would make a replay look like a new act.
      const existing = await database
        .selectFrom('app.bulletin_reports')
        .select('created_at')
        .where('bulletin_id', '=', write.bulletinId)
        .where('reporter_id', '=', write.viewerId)
        .executeTakeFirstOrThrow();

      return { bulletinId: write.bulletinId, viewerId: write.viewerId, hiddenAt: existing.created_at };
    },

    async dismiss(write: HideBulletinWrite): Promise<HiddenBulletin> {
      const inserted = await database
        .insertInto('app.bulletin_dismissals')
        .values({
          bulletin_id: write.bulletinId,
          viewer_id: write.viewerId,
          created_at: write.occurredAt,
        })
        .onConflict((onConflict) => onConflict.columns(['bulletin_id', 'viewer_id']).doNothing())
        .returning('created_at')
        .executeTakeFirst();

      if (inserted !== undefined) {
        return { bulletinId: write.bulletinId, viewerId: write.viewerId, hiddenAt: inserted.created_at };
      }

      const existing = await database
        .selectFrom('app.bulletin_dismissals')
        .select('created_at')
        .where('bulletin_id', '=', write.bulletinId)
        .where('viewer_id', '=', write.viewerId)
        .executeTakeFirstOrThrow();

      return { bulletinId: write.bulletinId, viewerId: write.viewerId, hiddenAt: existing.created_at };
    },

    async undismiss(write: HideBulletinWrite): Promise<RestoredBulletin> {
      // Scoped to this viewer's own row by `viewer_id`, which is where the authorization
      // for this operation actually lives: whatever `bulletin_id` names, the statement
      // can only reach a row this actor wrote. `occurredAt` is unused — a delete has
      // nothing to stamp — and the caller still passes it because
      // `HideBulletinWrite` is the shape every viewer-local write in this module takes.
      //
      // ⚠ `app.bulletin_reports` is deliberately untouched. A viewer who reported this
      // bulletin as well keeps it off their board; withdrawing a report is a different
      // decision (M5) and must never be a side effect of this one.
      //
      // No `returning`, and no read of what was deleted: whether a row was there is not a
      // distinction this operation reports (see `RestoredBulletin`), so asking would only
      // produce a value the caller must then decide to ignore.
      await database
        .deleteFrom('app.bulletin_dismissals')
        .where('bulletin_id', '=', write.bulletinId)
        .where('viewer_id', '=', write.viewerId)
        .execute();

      return { bulletinId: write.bulletinId, viewerId: write.viewerId };
    },

    async findDismissedFor(viewerId: string, limit: number): Promise<readonly string[]> {
      // ⚠ `app.bulletin_dismissals` alone. `findHiddenFor` below unions the reports table
      // because the board does not care which one hid a bulletin; here the union would be
      // the browsable report list M2-AC10/B9 exists to prevent.
      //
      // `created_at desc` is the dismissal order the Dismissed category reads in, with
      // `bulletin_id desc` breaking ties so two dismissals written in the same statement
      // do not swap places between reads.
      const rows = await database
        .selectFrom('app.bulletin_dismissals')
        .select('bulletin_id')
        .where('viewer_id', '=', viewerId)
        .orderBy('created_at', 'desc')
        .orderBy('bulletin_id', 'desc')
        .limit(limit)
        .execute();

      return rows.map((row) => row.bulletin_id);
    },

    async findHiddenFor(viewerId: string): Promise<ReadonlySet<string>> {
      // One statement over both tables rather than two round trips on the board's hot
      // path. `union` (not `union all`) because a viewer may have both dismissed and
      // later reported the same bulletin, and the caller's question is membership.
      const rows = await database
        .selectFrom('app.bulletin_reports')
        .select('bulletin_id')
        .where('reporter_id', '=', viewerId)
        .union(
          database
            .selectFrom('app.bulletin_dismissals')
            .select('bulletin_id')
            .where('viewer_id', '=', viewerId),
        )
        .execute();

      return new Set(rows.map((row) => row.bulletin_id));
    },
  };
}
