import { describe, expect, it } from 'vitest';

import {
  personalLinkShareBlurb,
  personalLinkShareText,
  personalLinkUrl,
} from './personal-link-share';

/**
 * Where a personal link points, and what travels with it (issue #206).
 *
 * The sibling of `invite-share.unit.test.ts`, holding the same #160 non-overlap rule for the
 * new object, plus the one thing that is genuinely different: this link's blurb has to
 * describe a request rather than a connection.
 */
describe('personalLinkUrl', () => {
  it('points at the /c/:slug route', () => {
    expect(personalLinkUrl('https://playapost.example', 'RAE7Q2Fabcdefghijklmn')).toBe(
      'https://playapost.example/c/RAE7Q2Fabcdefghijklmn',
    );
  });

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(personalLinkUrl('https://playapost.example/', 'abc')).toBe(
      'https://playapost.example/c/abc',
    );
  });

  it('strips every trailing slash, not just one', () => {
    expect(personalLinkUrl('https://playapost.example///', 'abc')).toBe(
      'https://playapost.example/c/abc',
    );
  });

  /*
   * ⚠ base64url needs no escaping today, which is exactly the kind of fact that stops being
   * true when somebody changes the alphabet to make the link prettier — at which point an
   * unescaped `/` would truncate every shared URL with no error to explain it.
   */
  it('percent-encodes a slug carrying characters that would truncate a path', () => {
    expect(personalLinkUrl('https://playapost.example', 'a/b#c')).toBe(
      'https://playapost.example/c/a%2Fb%23c',
    );
  });
});

describe('the share payload', () => {
  /*
   * ⚠ **AC1 of #160, restated for this object.** `text` carries the blurb alone; the link
   * travels solely in `url`. A share target that reads both fields verbatim — the OS share
   * sheet's own Copy action among them — pastes the link twice otherwise.
   */
  it('keeps the blurb free of any link', () => {
    expect(personalLinkShareBlurb()).not.toContain('http');
    expect(personalLinkShareBlurb()).not.toContain('/c/');
  });

  /*
   * ⚠ **The wording is the product promise, and it differs from the invite card's.** Both
   * are true; only this one describes what the person receiving *this* link is about to see.
   * Somebody who taps expecting to be connected and lands on a request button has been
   * misled by the message that came with it — which is the failure #206 was filed for,
   * arriving one layer earlier.
   */
  it('says the recipient is sending a request the owner answers', () => {
    const blurb = personalLinkShareBlurb();

    expect(blurb.toLowerCase()).toContain('request');
    expect(blurb.toLowerCase()).toContain('answer');
  });

  it('combines blurb and link for the clipboard fallback, which has one field', () => {
    const url = 'https://playapost.example/c/abc';

    expect(personalLinkShareText(url)).toBe(`${personalLinkShareBlurb()}\n${url}`);
  });
});
