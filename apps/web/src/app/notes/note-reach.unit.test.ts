import { describe, expect, it } from 'vitest';

import type { Person } from '@playa-post/contracts';

import { describeNoteReach } from './note-reach';

function person(degree: number, displayName?: string): Person {
  return {
    userId: 'user-1',
    degree,
    disclosure: displayName === undefined ? 'topology_only' : 'full',
    trust: null,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

describe('describeNoteReach', () => {
  describe('given a first-degree person', () => {
    it('offers the control, labelled with the comp’s sentence', () => {
      expect(describeNoteReach(person(1, 'Lena'))).toEqual({
        kind: 'can-pin',
        label: 'Pin a note to Lena’s board',
      });
    });

    // Degree, not disclosure, is the gate: somebody who shows you nothing about
    // themselves can still be the person you camped with.
    it('offers it for a first-degree person who discloses no name', () => {
      expect(describeNoteReach(person(1))).toEqual({
        kind: 'can-pin',
        label: 'Pin a note to their board',
      });
    });
  });

  describe('given somebody exactly two hops away', () => {
    it('offers the intro control, with the comp’s hint beside it', () => {
      expect(describeNoteReach(person(2, 'Kiki'))).toEqual({
        kind: 'can-request-intro',
        hint: 'Pinning a note needs a direct connection — Kiki is 2nd degree.',
        label: 'Request an intro to Kiki',
      });
    });

    it('offers it without inventing a name for an undisclosed person', () => {
      expect(describeNoteReach(person(2))).toEqual({
        kind: 'can-request-intro',
        hint: 'Pinning a note needs a direct connection — they are 2nd degree.',
        label: 'Request an intro',
      });
    });
  });

  describe('given somebody further away than an intro travels', () => {
    /*
     * ⚠ The control is withheld from the third degree out, and that is the *server's*
     * rule showing through: `app.intro_via_candidates` returns nothing past two hops, so
     * a button here would open a sheet with nothing to send.
     */
    it('says intros travel one hop, and offers nothing', () => {
      expect(describeNoteReach(person(3))).toEqual({
        kind: 'needs-connection',
        hint: 'Too far for an intro — intros travel one hop, and they are 3rd degree.',
      });
    });

    // The comp stops at "3rd" because its graph does. A person's own reach setting can
    // carry this one out to six hops, so the ordinal has to keep working past the comp —
    // and the intro control has to stay withheld the whole way.
    it('keeps ordinals right past the comp’s third degree, still with no control', () => {
      for (const degree of [4, 5, 6]) {
        const reach = describeNoteReach(person(degree, 'Omar'));

        expect(reach.kind).toBe('needs-connection');
        expect(reach).toMatchObject({
          hint: expect.stringContaining(`Omar is ${String(degree)}th degree`),
        });
        expect(reach).toMatchObject({ hint: expect.stringContaining('intros travel one hop') });
      }
    });
  });

  describe('given nobody to measure', () => {
    /*
     * Absent from the settled graph read. The requirement stands on its own; naming a
     * degree here would be a guess, and a guess about a person the viewer cannot see is
     * the beginning of the reachability probe the wire contract forbids.
     */
    it('states the requirement without naming a degree', () => {
      expect(describeNoteReach(undefined)).toEqual({
        kind: 'needs-connection',
        hint: 'Pinning a note needs a direct connection.',
      });
    });

    // Degree 0 is the viewer's own row. "0th degree" is nonsense, and the server refuses
    // a note to yourself anyway.
    it('does not offer to pin a note to yourself, and does not say "0th degree"', () => {
      expect(describeNoteReach(person(0, 'You'))).toEqual({
        kind: 'needs-connection',
        hint: 'Pinning a note needs a direct connection.',
      });
    });
  });
});
