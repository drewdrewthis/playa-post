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

  describe('given somebody further away', () => {
    it('gives the comp’s hint, naming the degree the viewer can already see', () => {
      expect(describeNoteReach(person(2, 'Kiki'))).toEqual({
        kind: 'needs-connection',
        hint: 'Pinning a note needs a direct connection — Kiki is 2nd degree. Request an intro to reach them.',
      });
    });

    it('says "they are" rather than inventing a name for an undisclosed person', () => {
      expect(describeNoteReach(person(3))).toEqual({
        kind: 'needs-connection',
        hint: 'Pinning a note needs a direct connection — they are 3rd degree. Request an intro to reach them.',
      });
    });

    // The comp stops at "3rd" because its graph does. A person's own reach setting can
    // carry this one out to six hops, so the ordinal has to keep working past the comp.
    it('keeps ordinals right past the comp’s third degree', () => {
      expect(describeNoteReach(person(4, 'Omar')).kind).toBe('needs-connection');
      expect(describeNoteReach(person(4, 'Omar'))).toMatchObject({
        hint: expect.stringContaining('Omar is 4th degree'),
      });
      expect(describeNoteReach(person(6, 'Omar'))).toMatchObject({
        hint: expect.stringContaining('Omar is 6th degree'),
      });
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
