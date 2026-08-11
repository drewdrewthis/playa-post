import { describe, expect, it } from 'vitest';

import type { IntroPerson } from '@playa-post/contracts';

import {
  askViaLabel,
  INTRO_CONSENT_LINE,
  INTRO_NOT_PASSED_ON_LINE,
  INTRO_VIA_NOTE_LINE,
  INTRO_VOUCHED_LINE,
  introPendingLabel,
  introPersonName,
  introRefusalMessage,
  introSheetTitle,
  PASS_ON_WITH_NOTE_LABEL,
  requestIntroLabel,
  viaNoteLabel,
} from './intro-copy';

/*
 * Built field by field rather than by spreading a `Partial`: `exactOptionalPropertyTypes`
 * makes `displayName?: string` and `displayName?: string | undefined` two different
 * types, and a §6a-withheld person is the *absence* of the key.
 */
const NAMED: IntroPerson = { userId: 'person-1', disclosure: 'full', displayName: 'Lena' };
const HANDLE_ONLY: IntroPerson = { userId: 'person-1', disclosure: 'full', handle: 'lena' };
const WITHHELD: IntroPerson = { userId: 'user-9f3c', disclosure: 'topology_only' };

describe('introPersonName', () => {
  it('reads the disclosed display name', () => {
    expect(introPersonName(NAMED)).toBe('Lena');
  });

  it('falls back to the handle, at-prefixed, when that is what was disclosed', () => {
    expect(introPersonName(HANDLE_ONLY)).toBe('@lena');
  });

  /*
   * ⚠ The whole point. A withheld person is `null` — never the `userId`, never an
   * initial, never "Unknown". Every sentence below has a form that works without a name,
   * which is why this may safely return one.
   */
  it('is null for a person the projection withheld, and never their identifier', () => {
    expect(introPersonName(WITHHELD)).toBeNull();
  });

  it('is null for an absent card, which is what an aged-out relationship sends', () => {
    expect(introPersonName(undefined)).toBeNull();
  });
});

describe('the sentences an intro surface says', () => {
  it('names the person when it may, and says "them" when it may not', () => {
    expect(introSheetTitle('Kiki')).toBe('Intro to Kiki');
    expect(introSheetTitle(null)).toBe('Intro to them');

    expect(requestIntroLabel('Kiki')).toBe('Request an intro to Kiki');
    expect(requestIntroLabel(null)).toBe('Request an intro');

    expect(askViaLabel('Lena')).toBe('Ask Lena to introduce you');
    expect(askViaLabel(null)).toBe('Ask them to introduce you');

    expect(introPendingLabel('Lena')).toBe('Intro pending via Lena');
    expect(introPendingLabel(null)).toBe('Intro pending');

    expect(viaNoteLabel('Kiki')).toBe('Add your own note for Kiki');
    expect(viaNoteLabel(null)).toBe('Add your own note for them');
  });

  /*
   * ⚠ The requirement has to be readable before the submit is pressed (#175). A via who
   * meets "you have to add your own message" as a dead button reads it as a bug in the
   * app rather than as something being asked of them.
   */
  it('tells a via the note is required, and that the target will read it', () => {
    expect(INTRO_VIA_NOTE_LINE).toContain('required');
    expect(INTRO_VIA_NOTE_LINE).toContain('they will read it');
    expect(PASS_ON_WITH_NOTE_LABEL).toBe('Pass on with your note');
  });

  /*
   * The target's row carries two notes by two people, and this is the sentence that keeps
   * the second one attributed. It has to name an action rather than a feeling: "passed it
   * on" is what happened, and anything warmer would put the app's opinion in the via's
   * mouth alongside their own words.
   */
  it('attributes the via’s half of an introduction to the via', () => {
    expect(INTRO_VOUCHED_LINE).toBe('passed it on:');
  });

  /*
   * The consent inversion, in words: sending shows the target the requester's identity
   * and their note even when the requester's own visibility setting would hide them. The
   * server does that deliberately, so the sheet has to say it before send.
   */
  it('tells a requester that being passed on shows the target who they are and what they wrote', () => {
    expect(INTRO_CONSENT_LINE).toContain('see who you are');
    expect(INTRO_CONSENT_LINE).toContain('read your note');
    expect(INTRO_CONSENT_LINE).toContain('visibility setting');
  });

  /*
   * ⚠ No reason, and nothing that reads as an invitation to ask again. The wire carries
   * no reason because there is none to send, and "not yet" would be a re-ask prompt with
   * better manners.
   */
  it('reports a decline without a reason and without inviting another ask', () => {
    expect(INTRO_NOT_PASSED_ON_LINE).toContain('not passed on');
    expect(INTRO_NOT_PASSED_ON_LINE).not.toMatch(/again|why|reason|yet/i);
  });
});

describe('introRefusalMessage', () => {
  /*
   * ⚠ `INTRO_UNAVAILABLE` comes back identically for a target at the wrong distance, a
   * via who does not know them, somebody who does not exist, an ask already open, and a
   * decision that is not this actor's to make. Any word here that narrowed it would be
   * this client rebuilding the oracle the server closed.
   */
  it('renders INTRO_UNAVAILABLE flat, naming no cause', () => {
    const message = introRefusalMessage('INTRO_UNAVAILABLE');

    expect(message).toBe('That introduction is not available.');
    expect(message).not.toMatch(/degree|hop|already|declin|exist|connect/i);
  });

  it('tells a writer their own note was refused, which discloses nothing', () => {
    expect(introRefusalMessage('INTRO_CONTENT_INVALID')).toContain('Shorten it');
  });

  /*
   * Reachable only from a client that got the wire shape wrong — the decline control
   * sends no note, and `DecideIntroRequest`'s union will not let it — so this says what
   * happened rather than apologising for it. There is nothing the reader can do.
   */
  it('states plainly that declining sends no note', () => {
    expect(introRefusalMessage('INTRO_DECLINE_CARRIES_NO_NOTE')).toBe('Declining sends no note.');
  });

  // A dropped connection carries no application code, and must not be rendered as a
  // refusal the server made.
  it('does not turn a transport failure into a server answer', () => {
    expect(introRefusalMessage(null)).toBe('That did not send. Try again.');
  });

  it('shows an unknown code rather than swallowing it', () => {
    expect(introRefusalMessage('SOMETHING_NEW')).toContain('SOMETHING_NEW');
  });
});
