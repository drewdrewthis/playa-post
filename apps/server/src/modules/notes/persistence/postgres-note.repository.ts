import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import type { VisibleNote } from '../application/visible-note';
import type { VisibleNotesRepository } from '../application/visible-notes.repository';
import type { Note } from '../domain/note';
import { NoteRecipientUnreachableError } from '../domain/note.errors';
import { notePinned, type NotePinned } from '../domain/note.events';
import type { NewNote, NoteRepository } from '../domain/note.repository';

import { toNote, type NoteRow } from './note.mapper';
import { toVisibleNote, type VisibleNoteRow } from './visible-note.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNoteRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * How far a note may travel: exactly one hop.
 *
 * Passed as `app.visible_people`'s `max_depth` *and* compared against the returned
 * `degree`, because the two say different things and both are needed. The depth argument
 * stops the traversal doing work whose rows would be discarded; the equality is the
 * actual rule, and it is what excludes the author themselves — nobody is at degree 1 of
 * themselves, so "a note to yourself" is refused by the same predicate that refuses a
 * stranger, with no separate check to forget.
 */
const NOTE_RECIPIENT_DEGREE = 1;

/**
 * The node budget this membership check gives `app.visible_people`.
 *
 * ⚠ **Deliberately far above the function's own default of 1500, and that is not a
 * performance knob.** The default exists to bound a *display* read of the network, where
 * ordering by `(degree, person_id)` and truncating is a reasonable answer. Here the
 * question is "is this one person a direct connection", and a truncated set would answer
 * *no* for somebody the author really is connected to — refusing a legitimate pin
 * because of where their UUID sorts. At `max_depth => 1` the set is only the author's own
 * connections, so a budget this size costs nothing and buys the guarantee that this
 * check's answer is about the connection and never about the budget.
 */
const NOTE_RECIPIENT_NODE_BUDGET = 1_000_000;

/**
 * The projection every read of `app.visible_notes` selects.
 *
 * Named columns rather than `select *`, matching
 * `modules/bulletins/persistence/postgres-bulletin.repository.ts`: written once so a
 * second read cannot drift into a second shape for {@link VisibleNoteRow} to be right
 * about only one of.
 */
const VISIBLE_NOTE_COLUMNS = sql`
  note_id, author_id, body, created_at,
  author_disclosure, author_display_name, author_handle
`;

/**
 * `app.notes` and `app.visible_notes`, behind both of this module's ports.
 *
 * One object implementing two interfaces, because they describe two *questions* rather
 * than two stores: {@link NoteRepository} is the author writing, and
 * {@link VisibleNotesRepository} is the §6a-projected set the recipient reads. Consumers
 * declare whichever they need, so the pin service cannot reach a read and the list query
 * cannot reach a write.
 *
 * Every statement is schema-qualified (`app.notes`, never `notes`) per ADR-0002's
 * pooler-safety rules: with `search_path` outside this file's control, an unqualified
 * name is a silent cross-schema read waiting for a `public.notes` to exist.
 *
 * ⚠ This file also writes `app.outbox_events`, which is not a layering slip: a state
 * change and its event are **one transactional fact** (addendum §10, ADR-0006), and a
 * port per table would make the atomicity a convention two services have to remember
 * rather than a guarantee the database enforces.
 */
export function createPostgresNoteRepository(
  dependencies: PostgresNoteRepositoryDependencies,
): NoteRepository & VisibleNotesRepository {
  const { database } = dependencies;

  return {
    async pin(write: NewNote): Promise<Note> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **The authorization is this statement, not a step before it.** One
        // `INSERT … SELECT … WHERE EXISTS`, so a pair that is not directly connected
        // inserts zero rows and the refusal is decided by the same snapshot as the
        // write — there is no read-then-write window in which a connection could be
        // removed, and no ordering a future editor could rearrange (ADR-0005 precedence
        // rule 1, expressed where it cannot be moved).
        //
        // ⚠ It composes `app.visible_people` rather than joining `app.connections`.
        // Reachability has exactly one definition (ADR-0002 §6, ADR-0004:75-77), and a
        // membership test written against the connections table here would be a second
        // one — R2, the plan's only Critical-severity risk — reachable only through this
        // write path, where nothing else in the build could see it: a Kysely builder is
        // not a `.sql` file, so `sql-table-ownership` never reads this line. Composing
        // also means the note channel inherits the rest of the person rules for free —
        // a deactivated, suspended or erased recipient is absent from the function and
        // is therefore refused (ADR-0002 B11), and blocking will prune them the day it
        // lands, with nothing to change here.
        const { rows } = await sql<NoteRow>`
          insert into app.notes (author_id, recipient_id, body, created_at)
          select ${write.authorId}::uuid,
                 ${write.recipientId}::uuid,
                 ${write.body},
                 ${write.createdAt}::timestamptz
           where exists (
                   select 1
                     from app.visible_people(
                            ${write.authorId}::uuid,
                            ${NOTE_RECIPIENT_DEGREE}::int,
                            ${NOTE_RECIPIENT_NODE_BUDGET}::int
                          ) reachable
                    where reachable.user_id = ${write.recipientId}::uuid
                      and reachable.degree = ${NOTE_RECIPIENT_DEGREE}::int
                 )
          returning id, author_id, recipient_id, body, created_at
        `.execute(transaction);

        const inserted = rows[0];

        if (inserted === undefined) {
          // Zero rows means the `EXISTS` was false, and this throw rolls the transaction
          // back — so a refused pin leaves zero rows in `app.notes` and zero in
          // `app.outbox_events`, which is the same atomicity guarantee M2-AC6 measures
          // for a bulletin. One error for every reason it could be false: telling "no
          // such person" apart from "not connected" is the user-existence oracle
          // ADR-0002 §10 forbids.
          throw new NoteRecipientUnreachableError();
        }

        const note = toNote(inserted);
        await appendOutboxEvent(transaction, notePinned(note));

        return note;
      });
    },

    async listFor(viewerId: string): Promise<readonly VisibleNote[]> {
      // `viewerId` travels as a bound parameter, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      //
      // No `order by` here: the function already orders newest-first, so a second one
      // would be a second answer to a question that has one (see `visible-notes.sql`).
      const { rows } = await sql<VisibleNoteRow>`
        select ${VISIBLE_NOTE_COLUMNS}
          from app.visible_notes(${viewerId})
      `.execute(database);

      return rows.map(toVisibleNote);
    },

    async findVisibleById(viewerId: string, noteId: string): Promise<VisibleNote | null> {
      // The same function the list reads, plus an id predicate — no second statement over
      // `app.notes` and no second `where` deciding readability. The predicate can only
      // narrow what the function already produced (B10 stated as a statement), so naming a
      // note addressed to somebody else returns zero rows rather than a refusal the caller
      // could tell apart from a note that never existed.
      //
      // ⚠ No `order by` and no `limit`: `note_id` is `app.notes`' primary key, so this
      // matches at most one row. A `limit 1` would suggest the function might return two.
      const { rows } = await sql<VisibleNoteRow>`
        select ${VISIBLE_NOTE_COLUMNS}
          from app.visible_notes(${viewerId})
         where note_id = ${noteId}
      `.execute(database);

      const row = rows[0];

      return row === undefined ? null : toVisibleNote(row);
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
  event: NotePinned,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and none was added for
      // this. v4 is a correct key — the ADR guarantees no ordering and consumers must
      // not assume any — and this is the one line that changes when a v7 source arrives.
      event_id: randomUUID(),
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_id: event.authorId,
      aggregate_id: event.noteId,
      // ⚠ Identifiers and routing data only — **never `body`**. A note is the most
      // private thing this product stores; a consumer re-reads it through
      // `app.visible_notes` if it needs it, which is also what stops a delivery carrying
      // text the current visibility rules have since withdrawn (ADR-0006, PDF §6), and
      // what keeps note content out of any log line that dumps an outbox row (M2-AC16).
      //
      // Passed as an object, not a `JSON.stringify`d string: the generated type for a
      // `jsonb` column is `Json`, so a string type-checks and stores a JSON *scalar*
      // that every consumer would then have to parse twice.
      payload: {
        noteId: event.noteId,
        authorId: event.authorId,
        recipientId: event.recipientId,
      },
    })
    .execute();
}
