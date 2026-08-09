import type { DatabaseConnection } from '@playa-post/database';

import { createListNotesQuery } from './application/list-notes.query';
import { createPinNoteService, type PinNoteService } from './application/pin-note.service';
import { createPostgresNoteRepository } from './persistence/postgres-note.repository';
import { createNotesRouter, type NotesRouter } from './transport/notes.router';

/** What the composition root has to hand this module. */
export interface NotesModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount, and one use case. */
export interface NotesModule {
  readonly router: NotesRouter;
  /**
   * The pin use case, for the composition root to register as
   * `sync.submitMutations`' `note.pin` handler (ADR-0005: an envelope is dispatched "to
   * the owning module's application service … so `sync` depends on modules' public
   * application interfaces and never on their internals").
   *
   * The **service**, not the repository: the offline path and the tRPC path must apply
   * the same content policy and write the same outbox event, and they do that by running
   * the same use case rather than by two callers agreeing to.
   *
   * ⚠ Unlike `bulletins.createBulletin`, this one has a real refusal an offline client
   * can hit: a recipient who was a connection when the note was composed may not be one
   * when the queue drains. That refusal is an `ApplicationError`, so the envelope comes
   * back `rejected` with `NOTE_RECIPIENT_UNREACHABLE` rather than failing the batch —
   * and it is refused by the *insert*, so nothing lands.
   */
  readonly pinNote: PinNoteService;
}

/**
 * Wire the notes module.
 *
 * **This file is the module's only wiring point**, the same shape `bulletins.module.ts`
 * establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the repository
 * and injects it.
 *
 * One repository instance serves both operations, because it is one connection pool over
 * one pair of ports — `NoteRepository` for the author's write and `VisibleNotesRepository`
 * for the recipient's §6a-projected read. Each service takes only the port it needs, so
 * nothing here hands the pin service a way to read somebody's notes.
 *
 * ⚠ **This module exists precisely so that a note is not a bulletin.** PDF §6 forbids
 * silently mixing fixed-recipient messaging into the bulletin model, decision D2 cut the
 * feature on that basis, and decision D6 reopens it on the condition that the separation
 * is structural rather than a naming convention: a separate table, a separate authorized
 * set (`app.visible_notes`), a separate router, and a `note` value that `bulletins.create`
 * still refuses. Nothing here may be folded back into `modules/bulletins` without
 * reopening D6.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createNotesModule(dependencies: NotesModuleDependencies): NotesModule {
  const notes = createPostgresNoteRepository({ database: dependencies.database });
  // Built once and mounted twice on purpose: the tRPC procedure and the offline
  // envelope's handler are two transports over one use case, not two use cases.
  const pinNote = createPinNoteService({ notes });

  return {
    router: createNotesRouter({ pinNote, listNotes: createListNotesQuery({ notes }) }),
    pinNote,
  };
}
