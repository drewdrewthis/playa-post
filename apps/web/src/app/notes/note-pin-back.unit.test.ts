import { describe, expect, it } from 'vitest';

import type { Note, Person } from '@playa-post/contracts';

import { describeNotePinBack } from './note-pin-back';

const AUTHOR_ID = 'author-1';

function person(degree: number, displayName?: string): Person {
  return {
    userId: AUTHOR_ID,
    degree,
    disclosure: displayName === undefined ? 'topology_only' : 'full',
    trust: null,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

/** A note with an author card — the ordinary case, where somebody can be answered. */
function noteFrom(displayName?: string): Note {
  return {
    id: 'note-1',
    body: 'The good coffee is in the blue bin.',
    createdAt: '2026-08-11T09:00:00.000Z',
    author: {
      userId: AUTHOR_ID,
      disclosure: displayName === undefined ? 'topology_only' : 'full',
      ...(displayName === undefined ? {} : { displayName }),
    },
  };
}

/**
 * A note whose author has left this viewer's world.
 *
 * ⚠ The `author` key is **absent**, not `null` — that is the shape the server actually
 * sends (`app.visible_notes` LEFT-joins the authorized set and projects every author
 * column from it), and the shape the whole "nobody to answer" rule keys off.
 */
const AUTHORLESS_NOTE: Note = {
  id: 'note-2',
  body: 'The spare goggles are yours.',
  createdAt: '2026-08-11T09:00:00.000Z',
};

describe('describeNotePinBack (#176)', () => {
  describe('given a note whose author is still a direct connection', () => {
    it('offers the control, addressed to the author and labelled with the comp’s sentence', () => {
      expect(describeNotePinBack(noteFrom('Lena'), [person(1, 'Lena')])).toEqual({
        kind: 'can-pin',
        recipientId: AUTHOR_ID,
        label: 'Pin a note to Lena’s board',
      });
    });

    // Degree, not disclosure, is the gate — and the label has a form that needs no name,
    // because §6a means one may genuinely not exist.
    it('offers it for an author who discloses no name, without inventing one', () => {
      // "their board" is the copy for a person §6a disclosed nothing about — not a
      // degraded form of the named sentence, and never the identifier standing in for a
      // name. The exhaustive `toEqual` is what keeps a third field from appearing.
      expect(describeNotePinBack(noteFrom(), [person(1)])).toEqual({
        kind: 'can-pin',
        recipientId: AUTHOR_ID,
        label: 'Pin a note to their board',
      });
    });
  });

  describe('given a note with no author card at all', () => {
    /*
     * The decision D14 records: the note opens, and there is nothing to answer. Asserted
     * ahead of the graph read on purpose — an absent card is a final answer, not a
     * pending one, so it must not depend on whether `graph.list` has landed.
     */
    it('offers nothing, whether or not the graph has been read', () => {
      expect(describeNotePinBack(AUTHORLESS_NOTE, [person(1, 'Lena')])).toEqual({
        kind: 'no-author',
      });
      expect(describeNotePinBack(AUTHORLESS_NOTE, undefined)).toEqual({ kind: 'no-author' });
    });

    // The whole point of the rule: there is no identifier in the payload to address, so a
    // control here could only be built out of one this viewer was never given.
    it('carries no recipient to address', () => {
      expect(describeNotePinBack(AUTHORLESS_NOTE, [])).not.toHaveProperty('recipientId');
    });
  });

  describe('given an author card whose person is further away than one hop', () => {
    /*
     * ⚠ A present card is not a reachable person. Pinning required degree 1 *at the time*;
     * `app.visible_notes` never re-derives it, so the author of a note on your board may
     * now be two hops away and still have a card. Offering the control here would put a
     * button on screen whose only outcome is `NOTE_RECIPIENT_UNREACHABLE`.
     */
    it('states the distance instead of offering a control', () => {
      expect(describeNotePinBack(noteFrom('Kiki'), [person(2, 'Kiki')])).toEqual({
        kind: 'out-of-reach',
        hint: 'Pinning a note needs a direct connection — Kiki is 2nd degree.',
      });
    });

    // No intro control on this surface, unlike the bulletin sheet: past the first degree
    // the note sheet says the distance and stops.
    it('offers no control at the second degree, only the hint', () => {
      expect(describeNotePinBack(noteFrom('Kiki'), [person(2, 'Kiki')])).not.toHaveProperty(
        'label',
      );
    });

    it('states the distance for somebody far out on the graph', () => {
      expect(describeNotePinBack(noteFrom('Rae'), [person(4, 'Rae')])).toEqual({
        kind: 'out-of-reach',
        hint: 'Too far for an intro — intros travel one hop, and Rae is 4th degree.',
      });
    });

    // An author who has fallen off the graph entirely but still has a card: the read
    // returns nothing about them, and `describeNoteReach` refuses to name a degree it
    // cannot see rather than guessing one.
    it('states the requirement for an author absent from the graph', () => {
      expect(describeNotePinBack(noteFrom('Lena'), [])).toEqual({
        kind: 'out-of-reach',
        hint: 'Pinning a note needs a direct connection.',
      });
    });

    /*
     * ⚠ The hint interpolates a name too, so it leaks by exactly the same route the label
     * does. Asserted separately because the label case cannot catch it: the two branches
     * take their name from the same place and only one of them is on screen at a time.
     */
    it('names nobody in the hint when the note withheld what the graph discloses', () => {
      expect(describeNotePinBack(noteFrom(), [person(2, 'Kiki')])).toEqual({
        kind: 'out-of-reach',
        hint: 'Pinning a note needs a direct connection — they are 2nd degree.',
      });
    });
  });

  /*
   * The two payloads answer two different questions, and the regression this file exists
   * to hold: the graph is the only one carrying a degree, the note's author card is the
   * §6a projection attached to this message, and a name may only ever come from the
   * second. `note-author.ts` states it — "never fill the gap in, not from the local
   * graph" — and the pin-back label was reading the graph's row until this caught it.
   */
  describe('given a note that withholds a name the viewer’s graph discloses', () => {
    it('offers the control without naming them, matching the author line’s own silence', () => {
      expect(describeNotePinBack(noteFrom(), [person(1, 'Lena')])).toEqual({
        kind: 'can-pin',
        recipientId: AUTHOR_ID,
        label: 'Pin a note to their board',
      });
    });

    // The other direction is not a leak and must keep working: a note that carries a name
    // is a name the server chose to disclose *with this note*, and a graph read that has
    // not caught up is no reason to withhold it.
    it('still names an author the note disclosed but the graph did not', () => {
      expect(describeNotePinBack(noteFrom('Lena'), [person(1)])).toEqual({
        kind: 'can-pin',
        recipientId: AUTHOR_ID,
        label: 'Pin a note to Lena’s board',
      });
    });
  });

  describe('given a graph read that has not landed', () => {
    /*
     * Distinct from every other silence here, and the distinction is why this is its own
     * case rather than a `null`: nothing is known yet, so nothing may be claimed. A
     * pending read rendering as "needs a direct connection" would tell somebody they
     * cannot answer their own friend.
     */
    it('says so, rather than claiming the author is out of reach', () => {
      expect(describeNotePinBack(noteFrom('Lena'), undefined)).toEqual({ kind: 'unsettled' });
    });
  });
});
