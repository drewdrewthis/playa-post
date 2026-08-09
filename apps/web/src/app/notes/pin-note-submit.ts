import type { OfflineDatabase, PendingMutationRow } from '../offline/database';
import { queueMutation } from '../offline/pending-mutations';
import type { SyncRunner } from '../offline/sync-runner';

import { buildPinNotePayload } from './pin-note-draft';
import { describePinNoteOutcome, type PinOutcomeKind } from './pin-note-outcome';

/**
 * What one press of Pin ended in: {@link PinOutcomeKind}, plus the one outcome that is
 * this device's rather than the server's.
 *
 * `not-saved` is a queue write that did not land — IndexedDB refused it, the storage
 * quota is full, the browser is in a mode that has no database. Nothing was recorded, so
 * it is neither a refusal (nobody judged the note) nor queued (there is no row).
 */
export type PinNoteSubmitKind = PinOutcomeKind | 'not-saved';

export interface PinNoteSubmitRequest {
  readonly database: OfflineDatabase;
  readonly syncRunner: SyncRunner;
  readonly recipientId: string;
  readonly body: string;
  /** What §6a lets this viewer call the recipient, or `null`. Never a placeholder. */
  readonly recipientName: string | null;
  /** The row an earlier press left in the queue, or `null` on a first press. */
  readonly queuedMutationId?: string | null;
}

export interface PinNoteSubmitResult {
  readonly kind: PinNoteSubmitKind;
  /** Ready to render. Never a bare code, and never an invented explanation of one. */
  readonly message: string;
  /**
   * The row to hand back on the next press, or `null` to write a fresh envelope.
   *
   * ⚠ **This is what stops a retry pinning a second note.** A row still `pending` is one
   * the next drain will claim; pressing again must replay *it* rather than mint a second
   * `mutationId`, which the server has no way to recognise as the same write.
   */
  readonly mutationId: string | null;
  /** Whether the screen stays on the form with the draft intact. */
  readonly stays: boolean;
}

/**
 * What to say when the note never reached this device's own queue.
 *
 * ⚠ Not a refusal, and it must never be worded as one: no server saw this note. The
 * remedy is the press itself, which is why the form comes back rather than staying
 * disabled with nothing on screen.
 */
export const NOTE_NOT_SAVED_MESSAGE = 'Couldn’t save your note on this device — try again.';

/**
 * Queue a note, drain, and read back what actually happened to it.
 *
 * ⚠ **This never rejects.** Every await here is a failure the screen has to survive — the
 * queue write, the drain, the read back — and a rejection would leave the compose form
 * disabled forever with nothing said, which is the one outcome worse than any of them.
 * The result is always something to render.
 *
 * ⚠ **Online and offline take this same path** (`pending-mutations.ts`), and the drain is
 * what makes the connected case feel immediate rather than what decides it. The queue row,
 * not the drain's return, is the account of what happened: a drain that threw says nothing
 * about this write, because the transport failing is not an answer about the note.
 */
export async function submitPinNote(
  request: PinNoteSubmitRequest,
): Promise<PinNoteSubmitResult> {
  const existing = await replayableRowId(request);
  const mutationId = existing ?? (await queueNote(request));

  if (mutationId === null) {
    return {
      kind: 'not-saved',
      message: NOTE_NOT_SAVED_MESSAGE,
      mutationId: null,
      stays: true,
    };
  }

  await drainQuietly(request.syncRunner);

  const settled = await readRow(request.database, mutationId);
  const outcome = describePinNoteOutcome(
    settled?.state ?? 'pending',
    settled?.lastError ?? null,
    request.recipientName,
  );

  return {
    kind: outcome.kind,
    message: outcome.message,
    mutationId: stillQueued(settled) ? mutationId : null,
    // The screen only leaves on a success. A refusal keeps the typed note on screen and
    // says what the server said; the refused row stays in the queue, where the shell's
    // pending badge accounts for it.
    stays: outcome.kind === 'refused',
  };
}

/**
 * The id an earlier press left behind, if the next drain could still act on it.
 *
 * ⚠ The drainer claims `pending` rows and nothing else, so a row in any other state is one
 * no further drain will move. Reusing such an id would be a Pin button that does nothing;
 * dropping it is what lets the next press write a fresh envelope — which is the right
 * answer for a write the server has already judged, and possibly for text since edited.
 */
async function replayableRowId(request: PinNoteSubmitRequest): Promise<string | null> {
  const queued = request.queuedMutationId ?? null;

  if (queued === null) {
    return null;
  }

  const row = await readRow(request.database, queued);

  return row !== null && row.state === 'pending' ? queued : null;
}

async function queueNote(request: PinNoteSubmitRequest): Promise<string | null> {
  try {
    const row = await queueMutation(request.database, {
      mutationType: 'note.pin',
      // Built once and never touched again: the server hashes the payload to decide
      // replay-versus-duplicate, so rebuilding it later would break idempotency.
      payload: buildPinNotePayload(request.recipientId, request.body),
    });

    return row.mutationId;
  } catch {
    return null;
  }
}

async function drainQuietly(syncRunner: SyncRunner): Promise<void> {
  try {
    await syncRunner.drain();
  } catch {
    // Deliberately swallowed. A drain covers every queued row, so its failure is not this
    // note's answer — the row read back below is.
  }
}

async function readRow(
  database: OfflineDatabase,
  mutationId: string,
): Promise<PendingMutationRow | null> {
  try {
    return (await database.pendingMutations.get(mutationId)) ?? null;
  } catch {
    // A store that cannot be read is not a store that lost the write. `pending` is the
    // state the row was written in, and the caller reads an unreadable row as that.
    return null;
  }
}

/** Whether another drain could still move this row. An unreadable one is assumed live. */
function stillQueued(row: PendingMutationRow | null): boolean {
  return row === null || row.state === 'pending';
}
