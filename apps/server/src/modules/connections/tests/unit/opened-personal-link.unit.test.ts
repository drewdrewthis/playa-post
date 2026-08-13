import { describe, expect, it } from 'vitest';

import type { ConnectionPerson } from '../../application/connection-person';
import {
  PERSONAL_LINK_VIEWER_STATE,
  toOpenedPersonalLink,
  type OpenedPersonalLinkFacts,
} from '../../application/opened-personal-link';

/**
 * Collapsing the database's facts into the one state a client renders (issue #206).
 *
 * A pure function with a **total, ordered** answer, tested at every combination rather than
 * at the happy path: the precedence between "already connected" and "already asked" is
 * invisible in the SQL that produces the facts, so this is the only place it is stated.
 */
const VIEWER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

function owner(userId: string): ConnectionPerson {
  return { userId, disclosure: 'full', displayName: 'Dusty', handle: 'dusty' };
}

function facts(overrides: Partial<OpenedPersonalLinkFacts> = {}): OpenedPersonalLinkFacts {
  return { owner: owner(OWNER), connected: false, requestPending: false, ...overrides };
}

describe('toOpenedPersonalLink (issue #206)', () => {
  it('passes the owner card through untouched', () => {
    // ⚠ Not enriched, not defaulted, not reshaped. §6a's projection already decided what
    // may be said about this person; a state function that also edited the card would be a
    // second place a name could be invented.
    expect(toOpenedPersonalLink(facts(), VIEWER).owner).toEqual(owner(OWNER));
  });

  it('answers `own` when the reader is the owner', () => {
    expect(toOpenedPersonalLink(facts({ owner: owner(VIEWER) }), VIEWER).viewerState).toBe(
      PERSONAL_LINK_VIEWER_STATE.own,
    );
  });

  it('answers `connected` when the pair already know each other', () => {
    expect(toOpenedPersonalLink(facts({ connected: true }), VIEWER).viewerState).toBe(
      PERSONAL_LINK_VIEWER_STATE.connected,
    );
  });

  it('answers `requested` when the reader has a live request waiting', () => {
    expect(toOpenedPersonalLink(facts({ requestPending: true }), VIEWER).viewerState).toBe(
      PERSONAL_LINK_VIEWER_STATE.requested,
    );
  });

  it('answers `open` when nothing is in the way', () => {
    expect(toOpenedPersonalLink(facts(), VIEWER).viewerState).toBe(
      PERSONAL_LINK_VIEWER_STATE.open,
    );
  });

  describe('precedence, where two facts are true at once', () => {
    /*
     * ⚠ `connected` beats `requested`, and the direction matters. A pair can reach this
     * state honestly — they connect through an invite or an introduction while a request
     * sits pending — and showing "request sent" to somebody who is already connected would
     * be a lie about what happens next, on a screen whose entire job is setting that
     * expectation.
     */
    it('reports `connected` over `requested`', () => {
      expect(
        toOpenedPersonalLink(facts({ connected: true, requestPending: true }), VIEWER).viewerState,
      ).toBe(PERSONAL_LINK_VIEWER_STATE.connected);
    });

    it('reports `own` over everything, including a nonsense pair of facts', () => {
      // Neither flag can honestly be true for your own link — the write path refuses a
      // self-request and the pair CHECK refuses a self-connection — so this pins the
      // ordering rather than a reachable state: `own` must win even if the query grows a
      // bug, because rendering a request button on your own link is the worst outcome.
      expect(
        toOpenedPersonalLink(
          { owner: owner(VIEWER), connected: true, requestPending: true },
          VIEWER,
        ).viewerState,
      ).toBe(PERSONAL_LINK_VIEWER_STATE.own);
    });
  });

  describe('the viewer identity it compares against', () => {
    it('is the supplied one, not anything read off the card', () => {
      // The control of the control: if the function compared the card to itself it would
      // answer `own` for everybody, and every assertion above except the first would still
      // need a different owner id to catch it. Asserted directly.
      expect(toOpenedPersonalLink(facts(), OWNER).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.own,
      );
      expect(toOpenedPersonalLink(facts(), VIEWER).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.open,
      );
    });
  });
});
