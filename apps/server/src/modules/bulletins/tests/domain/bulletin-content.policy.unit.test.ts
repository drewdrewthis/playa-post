import { describe, expect, it } from 'vitest';

import {
  BULLETIN_BODY_MAX_LENGTH,
  BULLETIN_LOC_MAX_LENGTH,
  BULLETIN_TITLE_MAX_LENGTH,
} from '../../domain/bulletin-content';
import { validateBulletinContent } from '../../domain/bulletin-content.policy';
import { BulletinContentInvalidError } from '../../domain/bulletin.errors';

/**
 * `validateBulletinContent` — the one place a bulletin's text bounds live.
 *
 * The location half is new (compose's "Where — e.g. 7:30 & E, Center Camp"); the title
 * and body cases are asserted alongside it because the three share one refusal type and
 * one trim pass, and a suite that covered only the new field would not notice the pass
 * being reordered around it.
 */
describe('validateBulletinContent', () => {
  const validContent = { title: 'Need a bike pump', body: 'Any time before Thursday.' };

  describe('title', () => {
    it('trims, so leading whitespace cannot disguise an empty title', () => {
      expect(() => validateBulletinContent({ ...validContent, title: '   ' })).toThrow(
        BulletinContentInvalidError,
      );
    });

    it('returns the trimmed value, which is what the caller must store', () => {
      const content = validateBulletinContent({ ...validContent, title: '  Need a pump  ' });

      expect(content.title).toBe('Need a pump');
    });

    it('refuses one longer than the bound', () => {
      expect(() =>
        validateBulletinContent({ ...validContent, title: 'x'.repeat(BULLETIN_TITLE_MAX_LENGTH + 1) }),
      ).toThrow(BulletinContentInvalidError);
    });
  });

  describe('body', () => {
    it('accepts an empty one — "Need a bike pump" is a complete Request', () => {
      const content = validateBulletinContent({ ...validContent, body: '' });

      expect(content.body).toBe('');
    });

    it('refuses one longer than the bound', () => {
      expect(() =>
        validateBulletinContent({ ...validContent, body: 'x'.repeat(BULLETIN_BODY_MAX_LENGTH + 1) }),
      ).toThrow(BulletinContentInvalidError);
    });
  });

  describe('loc', () => {
    it('is null when the author gave none', () => {
      expect(validateBulletinContent(validContent).loc).toBeNull();
    });

    it('is null when the author submitted only whitespace, never an empty string', () => {
      // An untouched form input submits `''`. Storing it would give the board two
      // representations of "names no place", one of which renders a stray separator in
      // the `◦ {loc} · {author}` meta line.
      expect(validateBulletinContent({ ...validContent, loc: '   ' }).loc).toBeNull();
      expect(validateBulletinContent({ ...validContent, loc: '' }).loc).toBeNull();
    });

    it('returns the trimmed value', () => {
      expect(validateBulletinContent({ ...validContent, loc: '  7:30 & E  ' }).loc).toBe('7:30 & E');
    });

    it(`accepts one of exactly ${String(BULLETIN_LOC_MAX_LENGTH)} characters`, () => {
      const atBound = 'x'.repeat(BULLETIN_LOC_MAX_LENGTH);

      expect(validateBulletinContent({ ...validContent, loc: atBound }).loc).toBe(atBound);
    });

    it('refuses one longer than the bound, naming the field', () => {
      expect(() =>
        validateBulletinContent({ ...validContent, loc: 'x'.repeat(BULLETIN_LOC_MAX_LENGTH + 1) }),
      ).toThrow(BulletinContentInvalidError);
    });

    it('refuses it with the stable BULLETIN_CONTENT_INVALID code, not a generic error', () => {
      // The code is what a client branches on to put the message beside the right
      // input; a `BAD_REQUEST` with prose would make it parse the message instead.
      expect(() =>
        validateBulletinContent({ ...validContent, loc: 'x'.repeat(BULLETIN_LOC_MAX_LENGTH + 1) }),
      ).toThrow(expect.objectContaining({ code: BulletinContentInvalidError.code }));
    });

    it('measures the bound after trimming, so surrounding whitespace is not charged for it', () => {
      const padded = `  ${'x'.repeat(BULLETIN_LOC_MAX_LENGTH)}  `;

      expect(validateBulletinContent({ ...validContent, loc: padded }).loc).toHaveLength(
        BULLETIN_LOC_MAX_LENGTH,
      );
    });
  });
});
