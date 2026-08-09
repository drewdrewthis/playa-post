import { describe, expect, it } from 'vitest';

import { describePinNoteOutcome } from './pin-note-outcome';

describe('describePinNoteOutcome', () => {
  it('reports a synced row as pinned, in the comp’s words', () => {
    expect(describePinNoteOutcome('synced', null, 'Lena')).toEqual({
      kind: 'pinned',
      message: 'Pinned to Lena’s board — only they see it',
    });
  });

  it('reports a still-queued row as a success the user can walk away from', () => {
    expect(describePinNoteOutcome('pending', null, 'Lena')).toEqual({
      kind: 'queued',
      message: 'Queued — will sync when you’re back.',
    });
    expect(describePinNoteOutcome('inflight', null, 'Lena').kind).toBe('queued');
  });

  /*
   * ⚠ Both are refusals. A pin cannot really conflict — a note names no pre-existing
   * subject to conflict with — but the state is representable, and rendering it as a
   * success would tell somebody their note is on a board it never reached.
   */
  it('reports failed and conflicted as refusals, never as a success', () => {
    expect(describePinNoteOutcome('failed', null, 'Lena').kind).toBe('refused');
    expect(describePinNoteOutcome('conflicted', null, 'Lena').kind).toBe('refused');
  });

  /*
   * ⚠ The refusal is answered with the *requirement*, never with a fact about the
   * recipient. The server returns this code identically for a second-degree person, a
   * stranger, a deactivated account, a UUID naming nobody, and yourself — so copy that
   * said "you are not connected to them" would be this client inventing the one
   * distinction the wire contract spent its design refusing to make.
   */
  it('answers an unreachable recipient with the requirement, disclosing nothing about them', () => {
    const outcome = describePinNoteOutcome('failed', 'NOTE_RECIPIENT_UNREACHABLE', 'Lena');

    expect(outcome).toEqual({
      kind: 'refused',
      message:
        'That note was not pinned — pinning a note needs a direct connection to the person you are writing to.',
    });
    expect(outcome.message).not.toContain('Lena');
    expect(outcome.message).not.toContain('exist');
  });

  it('names what the author can fix when the server refused the text', () => {
    expect(describePinNoteOutcome('failed', 'NOTE_CONTENT_INVALID', 'Lena').message).toBe(
      'The server refused this note’s text. Shorten it and pin again.',
    );
  });

  /*
   * A code nobody has written copy for is shown as itself. A friendly sentence written
   * over an unread code is how somebody ends up retrying the one thing that cannot work.
   */
  it('shows an unknown code rather than explaining it', () => {
    expect(describePinNoteOutcome('failed', 'MUTATION_PAYLOAD_INVALID', null).message).toBe(
      'The server refused this note: MUTATION_PAYLOAD_INVALID',
    );
  });

  it('says the plain thing when the refusal carried no code at all', () => {
    expect(describePinNoteOutcome('failed', null, null).message).toBe(
      'The server refused this note.',
    );
  });

  it('reports a pin to somebody with no disclosed name without a hole in the sentence', () => {
    expect(describePinNoteOutcome('synced', null, null).message).toBe(
      'Pinned to their board — only they see it',
    );
  });
});
