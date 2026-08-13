import { describe, expect, it } from 'vitest';

import { INVITE_TOKEN_ENTROPY_BYTES } from '../../domain/invite-token';
import {
  generatePersonalLinkSlug,
  PERSONAL_LINK_SLUG_ENTROPY_BYTES,
} from '../../domain/personal-link';

/**
 * The personal-link slug generator (issue #206, ADR-0018 D2).
 *
 * The mirror of `invitations.unit.test.ts`'s token block, with one difference that is the
 * whole point of the feature: a slug is an **address**, not a bearer credential, so its
 * entropy requirement is anti-enumeration rather than anti-forgery.
 */
describe('personal-link slug (issue #206)', () => {
  describe('entropy', () => {
    it('draws 16 bytes — enough to defeat enumeration, and deliberately less than a token', () => {
      expect(PERSONAL_LINK_SLUG_ENTROPY_BYTES).toBe(16);
    });

    /*
     * ⚠ Asserted as a *relationship*, not two independent numbers. The two constants encode
     * a claim about what each object is: holding a token connects you, holding a slug buys
     * a button. Somebody raising the slug to 32 "for consistency" would be erasing the
     * distinction this test exists to keep legible, and somebody lowering the token to 16
     * would be weakening a credential.
     */
    it('is strictly weaker than an invite token, because it is not a credential', () => {
      expect(PERSONAL_LINK_SLUG_ENTROPY_BYTES).toBeLessThan(INVITE_TOKEN_ENTROPY_BYTES);
    });

    it('asks the source for exactly that many bytes and never stretches a shorter seed', () => {
      const asked: number[] = [];
      generatePersonalLinkSlug({ id: 'owner-1' }, (byteLength) => {
        asked.push(byteLength);
        return 'stub';
      });

      expect(asked).toEqual([PERSONAL_LINK_SLUG_ENTROPY_BYTES]);
    });
  });

  describe('the owner', () => {
    /*
     * ⚠ **The sharper half of M2-AC17's rule, because this link is published.** A slug
     * derived from its owner would make every copy of the URL — in a chat, on a photo of a
     * screen, in somebody's browser history — a standing disclosure of who published it, in
     * a product whose PDF §4 promises there is no people search.
     */
    it('is ignored: two different owners drawing the same bytes get the same slug', () => {
      const constantSource = (): string => 'ZZZZ';

      expect(generatePersonalLinkSlug({ id: 'owner-1' }, constantSource)).toBe(
        generatePersonalLinkSlug({ id: 'owner-2' }, constantSource),
      );
    });

    it('is ignored the other way round: one owner drawing different bytes gets different slugs', () => {
      // The control of the control. Without it the assertion above passes for a generator
      // that returns a constant regardless of its source, which would be a far worse bug
      // than the one it is meant to catch.
      const slugs = ['first', 'second'];
      const source = (): string => slugs.shift() ?? '';

      expect(generatePersonalLinkSlug({ id: 'owner-1' }, source)).toBe('first');
      expect(generatePersonalLinkSlug({ id: 'owner-1' }, source)).toBe('second');
    });

    it('does not appear in the slug even as a substring', () => {
      // `generatePersonalLinkSlug` receives the id and must not fold it in anywhere — a
      // prefix, a suffix, a separator. Asserted against the real default source, so this
      // covers the shipping code path rather than a stub's behaviour.
      const ownerId = '5f3a9c22-4b1e-4a7d-9c88-1d2e3f4a5b6c';

      expect(generatePersonalLinkSlug({ id: ownerId })).not.toContain(ownerId);
    });
  });

  describe('the minted value', () => {
    it('is base64url and long enough to be unguessable', () => {
      const slug = generatePersonalLinkSlug({ id: 'owner-1' });

      // 16 bytes base64url-encodes to 22 characters with no padding.
      expect(slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    /*
     * ⚠ **Unlinkable across rotations.** Somebody who saw the old URL must not be able to
     * recognise the new one, or rotating announces itself to exactly the person it exists
     * to shed — which is the anti-oracle property ADR-0018 D3 rests on, seen from the
     * generator's end rather than the database's.
     */
    it('differs on every draw, so a rotation is unrecognisable to whoever held the old link', () => {
      const drawn = new Set(
        Array.from({ length: 50 }, () => generatePersonalLinkSlug({ id: 'owner-1' })),
      );

      expect(drawn.size).toBe(50);
    });
  });
});
