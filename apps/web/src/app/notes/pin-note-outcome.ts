import type { PendingMutationState } from '../offline/database';

import { notePinnedMessage } from './note-recipient';

/**
 * What happened to a queued note, once the drain has settled.
 *
 * A deliberate sibling of `bulletins/compose-bulletin-outcome.ts` rather than a shared
 * generic one: the two screens agree on which *states* are successes and disagree on
 * every *word*, and a function taking enough parameters to say both sentences would be
 * harder to read than two functions that each say one. The exhaustive `switch` is the
 * safety property, and having it twice means a sixth {@link PendingMutationState} fails
 * to compile in both places — which is the outcome worth having.
 */
export type PinOutcomeKind = 'pinned' | 'queued' | 'refused';

export interface PinNoteOutcome {
  readonly kind: PinOutcomeKind;
  /** Ready to render. Never a bare code, and never an invented explanation of one. */
  readonly message: string;
}

/**
 * The two server codes this form can actually provoke, in words.
 *
 * ⚠ `NOTE_RECIPIENT_UNREACHABLE` is answered with the **requirement**, never with a fact
 * about the recipient. The server returns it identically for a second-degree person, a
 * stranger, a deactivated account, a UUID naming nobody, and yourself
 * (`packages/contracts/src/notes.ts`) — so "you are not connected to them" would be this
 * client inventing the one distinction the server spent its design refusing to make.
 *
 * ⚠ It is a **live** refusal offline, not a defensive branch: a recipient who was a first
 * -degree connection when the note was composed need not be one when the queue drains,
 * and the insert refuses it then (`composition/container.ts`).
 */
const REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  NOTE_RECIPIENT_UNREACHABLE:
    'That note was not pinned — pinning a note needs a direct connection to the person you are writing to.',
  NOTE_CONTENT_INVALID: 'The server refused this note’s text. Shorten it and pin again.',
};

/**
 * Read a settled queue row as something to say to the person who pressed Pin.
 *
 * ⚠ **`failed` and `conflicted` are both refusals, and neither may be rendered as a
 * success.** A pin cannot really conflict — a note names no pre-existing subject to
 * conflict with — but the state is representable, and a switch that let an unhandled
 * state fall through to "Pinned" would tell somebody their note is on a board it never
 * reached.
 *
 * @param state - The row's state after `SyncRunner.drain()` has settled it.
 * @param lastError - The server's stable code, a transport failure's name, or `null`.
 * @param recipientName - What §6a lets this viewer call the recipient, or `null`.
 */
export function describePinNoteOutcome(
  state: PendingMutationState,
  lastError: string | null,
  recipientName: string | null,
): PinNoteOutcome {
  switch (state) {
    case 'synced':
      return { kind: 'pinned', message: notePinnedMessage(recipientName) };

    case 'pending':
      // The comp's string to the character (`design/Playa Post.dc.html:907`), which ends
      // without a full stop — every other pill on that screen does too.
      return { kind: 'queued', message: 'Queued — will sync when you’re back' };

    case 'inflight':
      return { kind: 'queued', message: 'Still syncing — it will land shortly.' };

    case 'failed':
    case 'conflicted':
      return { kind: 'refused', message: refusalMessage(lastError) };
  }
}

function refusalMessage(code: string | null): string {
  if (code === null) {
    return 'The server refused this note.';
  }

  return REFUSAL_MESSAGE[code] ?? `The server refused this note: ${code}`;
}
