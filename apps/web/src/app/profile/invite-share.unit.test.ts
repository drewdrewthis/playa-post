import { describe, expect, it } from 'vitest';

import { inviteShareText, inviteUrl } from './invite-share';

/**
 * The CONNECT card's link (design/Playa Post.dc.html: `playapost.net/j/RAE-7Q2F`).
 *
 * The comp's path is `/j/<code>`; this app's invite route is `/invite/:token`
 * (`app/router.tsx`), and the route is the thing that has to work — a link matching the
 * comp's prototype path would be a dead link that looked right in a screenshot.
 */
describe('the invite link', () => {
  it('points at the route that actually opens an invite', () => {
    expect(inviteUrl('https://playapost.example', 'RAE-7Q2F')).toBe(
      'https://playapost.example/invite/RAE-7Q2F',
    );
  });

  it('does not double a slash when the origin carries a trailing one', () => {
    expect(inviteUrl('https://playapost.example/', 'RAE-7Q2F')).toBe(
      'https://playapost.example/invite/RAE-7Q2F',
    );
  });

  /**
   * ⚠ A token is a bearer credential — whoever holds it can connect. Percent-encoding it
   * is not cosmetic: an unencoded `/` or `#` would silently truncate the link and hand
   * somebody an invite that cannot be accepted.
   */
  it('encodes a token that would otherwise break the path', () => {
    expect(inviteUrl('https://playapost.example', 'a/b#c')).toBe(
      'https://playapost.example/invite/a%2Fb%23c',
    );
  });

  /**
   * The share sheet's body. It says what accepting does, because a bare URL in a
   * messaging app is a link somebody is being asked to trust with no stated purpose —
   * and the comp's own copy makes the consent explicit: "Nothing happens until you both
   * consent."
   */
  it('carries the link and says what it does', () => {
    const text = inviteShareText('https://playapost.example/invite/RAE-7Q2F');

    expect(text).toContain('https://playapost.example/invite/RAE-7Q2F');
    expect(text.toLowerCase()).toContain('consent');
  });
});
