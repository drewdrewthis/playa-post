import { describe, expect, it } from 'vitest';

import type { Person } from '@playa-post/contracts';

import {
  composeNoteTitle,
  notePinnedMessage,
  notePrivacyLine,
  noteRecipientName,
  noteRecipientParam,
  pinNoteButtonLabel,
} from './note-recipient';

/** A person as `graph.list` hands one over; `undefined` name fields are simply absent. */
function person(userId: string, degree: number, displayName?: string): Person {
  return {
    userId,
    degree,
    disclosure: displayName === undefined ? 'topology_only' : 'full',
    trust: null,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

describe('noteRecipientParam', () => {
  it('reads the recipient a link names', () => {
    expect(noteRecipientParam('3f2a91c4-0000-4000-8000-000000000000')).toBe(
      '3f2a91c4-0000-4000-8000-000000000000',
    );
  });

  /*
   * ⚠ Whitespace is nobody. `?noteTo=%20` used to open a compose screen addressed to " ",
   * whose every submit is refused with `MUTATION_PAYLOAD_INVALID` — a screen doomed
   * before it rendered. The bulletin sheet is the harmless reading of a mangled link.
   */
  it.each([null, '', ' ', '   ', '\t', '\n'])(
    'reads %j as naming nobody, so the route falls back to the bulletin sheet',
    (raw) => {
      expect(noteRecipientParam(raw)).toBeNull();
    },
  );

  // Trimmed on the way through: the padding must not reach a payload the server hashes.
  it('hands on the trimmed id rather than the padding around it', () => {
    expect(noteRecipientParam('  person-1  ')).toBe('person-1');
  });
});

describe('noteRecipientName', () => {
  it('uses the disclosed display name', () => {
    expect(noteRecipientName(person('user-1', 1, 'Lena'))).toBe('Lena');
  });

  /*
   * ⚠ The §6a case. A person can be on the graph with nothing disclosed, and the answer
   * is *no name* — never initials, never a truncated `userId`, never "Unknown". Any of
   * those re-identifies the person the projection just hid.
   */
  it('answers null for a person the projection disclosed no name for', () => {
    expect(noteRecipientName(person('3f2a91c4-0000-4000-8000-000000000000', 1))).toBeNull();
  });

  it('answers null for somebody absent from the graph rather than naming them', () => {
    expect(noteRecipientName(undefined)).toBeNull();
  });
});

describe('the copy a name is written into', () => {
  it('names the recipient in the comp’s sentences', () => {
    expect(composeNoteTitle('Lena')).toBe('Pin a note to Lena’s board');
    expect(notePrivacyLine('Lena')).toBe(
      'Private — it lands on Lena’s board and no one else sees it. This is how you reach people here.',
    );
    expect(pinNoteButtonLabel('Lena', true)).toBe('Pin to Lena’s board');
    expect(notePinnedMessage('Lena')).toBe('Pinned to Lena’s board — only they see it');
  });

  /*
   * The comp has no copy for this — every person in it is invented and every one has a
   * name. "their board" is that copy, and it has to read as a sentence rather than as a
   * template with a hole in it.
   */
  it('says "their board" when there is no name to write, in every sentence', () => {
    expect(composeNoteTitle(null)).toBe('Pin a note to their board');
    expect(notePrivacyLine(null)).toBe(
      'Private — it lands on their board and no one else sees it. This is how you reach people here.',
    );
    expect(pinNoteButtonLabel(null, true)).toBe('Pin to their board');
    expect(notePinnedMessage(null)).toBe('Pinned to their board — only they see it');
  });

  it('leaves no dangling possessive and no rendered null where the name was withheld', () => {
    for (const copy of [
      composeNoteTitle(null),
      notePrivacyLine(null),
      pinNoteButtonLabel(null, true),
      notePinnedMessage(null),
    ]) {
      expect(copy).not.toContain('’s');
      expect(copy).not.toContain('null');
      expect(copy).not.toContain('undefined');
    }
  });
});

describe('pinNoteButtonLabel', () => {
  // Offline the label names what happens next. The write is queued either way — that is
  // `pending-mutations.ts`'s whole design — so only the observable differs.
  it('says Queue note offline, naming no board it cannot reach yet', () => {
    expect(pinNoteButtonLabel('Lena', false)).toBe('Queue note');
    expect(pinNoteButtonLabel(null, false)).toBe('Queue note');
  });
});
