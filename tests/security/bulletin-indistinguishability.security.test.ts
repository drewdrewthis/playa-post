import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createCreateBulletinService } from '../../apps/server/src/modules/bulletins/application/create-bulletin.service';
import { createGetBulletinQuery } from '../../apps/server/src/modules/bulletins/application/get-bulletin.query';
import { BulletinGoneError } from '../../apps/server/src/modules/bulletins/domain/bulletin.errors';
import { createPostgresBulletinRepository } from '../../apps/server/src/modules/bulletins/persistence/postgres-bulletin.repository';
import { createGetNoteQuery } from '../../apps/server/src/modules/notes/application/get-note.query';
import { createPinNoteService } from '../../apps/server/src/modules/notes/application/pin-note.service';
import { NoteGoneError } from '../../apps/server/src/modules/notes/domain/note.errors';
import { createPostgresNoteRepository } from '../../apps/server/src/modules/notes/persistence/postgres-note.repository';

/**
 * ADR-0002 **B17** — "Unauthorized is indistinguishable from non-existent":
 * "Unauthorized and non-existent produce identical status, error code, and
 * byte-identical bodies across single-entity fetch, `from:` resolution,
 * intro-connector resolution, and report/dismiss of an invisible bulletin."
 *
 * The single-entity-fetch case, now on **both** of the two surfaces that have one:
 * `bulletins.getById` (M2-AC14) and `notes.getById` (#176, decision D14). `from:`
 * resolution and intro-connector resolution are M5. Duplicated from
 * `board-visibility-query.integration.test.ts`'s identical scenario per
 * `visibility-matrix.security.test.ts`'s own discipline: a B-row must be provable
 * from `tests/security/` alone, without cross-referencing a module's own test tree.
 *
 * ⚠ The file is named for bulletins and covers a second module, which is
 * `write-path-idor-bulletins.security.test.ts`'s established shape rather than an
 * oversight: `provenBy` is a single path, so a B-row's proof has to live in one file,
 * and the row is the unit of coverage rather than the filename.
 */
describe('B17 — an unauthorized identifier is indistinguishable from a never-existent one', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return id;
  }

  /** An accepted edge, which is what `notes.pin`'s degree-1 gate reads through. */
  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  it('answers identical status, code, and byte-identical bodies for both cases', async () => {
    const userA = await seedOnboardedUser('b17_bulletin_a');
    const viewerC = await seedOnboardedUser('b17_bulletin_c');

    const bulletins = createPostgresBulletinRepository({ database });
    const createBulletin = createCreateBulletinService({ bulletins });
    const getBulletin = createGetBulletinQuery({ bulletins });

    const created = await createBulletin.create({
      authorId: userA,
      type: 'request',
      title: 'Unauthorized to viewer C',
      body: 'Viewer C has no relationship to user A.',
    });

    const unauthorized: unknown = await getBulletin
      .getById({ actorId: viewerC, bulletinId: created.id })
      .catch((error: unknown) => error);
    const nonExistent: unknown = await getBulletin
      .getById({ actorId: viewerC, bulletinId: randomUUID() })
      .catch((error: unknown) => error);

    expect(unauthorized).toBeInstanceOf(BulletinGoneError);
    expect(nonExistent).toBeInstanceOf(BulletinGoneError);
    expect(JSON.stringify(unauthorized)).toBe(JSON.stringify(nonExistent));
  });

  /**
   * The same row on the note surface (#176, decision D14).
   *
   * ⚠ **Three inputs, not two, because a note has a third excluded reader: its own
   * author.** `app.visible_notes` gates on `recipient_id = viewer_id`, so the person who
   * wrote a note cannot fetch it back — and if that refusal differed by so much as a
   * message, `notes.getById` would become a delivery receipt for a channel that
   * deliberately has none (PDF §6). Comparing all three against one another is what makes
   * "the author is refused *exactly* as a stranger is" an assertion rather than a hope.
   */
  it('answers identically for a stranger, the note’s own author, and a never-existent note', async () => {
    const author = await seedOnboardedUser('b17_note_author');
    const recipient = await seedOnboardedUser('b17_note_recipient');
    const stranger = await seedOnboardedUser('b17_note_stranger');
    await seedAcceptedConnection(author, recipient);

    const notes = createPostgresNoteRepository({ database });
    const pinNote = createPinNoteService({ notes });
    const getNote = createGetNoteQuery({ notes });

    const pinned = await pinNote.pin({
      authorId: author,
      recipientId: recipient,
      body: 'Only the recipient may read this.',
    });

    // The positive control: without it, a query that refused *everybody* would pass every
    // assertion below and prove nothing at all.
    expect((await getNote.getById({ viewerId: recipient, noteId: pinned.id })).body).toBe(
      'Only the recipient may read this.',
    );

    const refusalFor = async (viewerId: string, noteId: string): Promise<unknown> =>
      getNote.getById({ viewerId, noteId }).catch((error: unknown) => error);

    const unauthorizedNote = await refusalFor(stranger, pinned.id);
    const ownAuthorship = await refusalFor(author, pinned.id);
    const nonExistentNote = await refusalFor(stranger, randomUUID());

    expect(unauthorizedNote).toBeInstanceOf(NoteGoneError);
    expect(ownAuthorship).toBeInstanceOf(NoteGoneError);
    expect(nonExistentNote).toBeInstanceOf(NoteGoneError);
    expect(JSON.stringify(unauthorizedNote)).toBe(JSON.stringify(nonExistentNote));
    expect(JSON.stringify(ownAuthorship)).toBe(JSON.stringify(nonExistentNote));

    // Nothing about the note survives into the refusal — not the body, not the author's
    // own identifier. A serialized error carrying either would leak through the one
    // channel this row exists to keep silent.
    expect(JSON.stringify(unauthorizedNote)).not.toContain('Only the recipient');
    expect(JSON.stringify(unauthorizedNote)).not.toContain(author);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
