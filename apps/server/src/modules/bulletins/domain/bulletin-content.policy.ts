import {
  BULLETIN_BODY_MAX_LENGTH,
  BULLETIN_TITLE_MAX_LENGTH,
  type BulletinContent,
} from './bulletin-content';
import { BulletinContentInvalidError } from './bulletin.errors';

/**
 * Accept a submitted title and body, or refuse them.
 *
 * Both are trimmed first, so leading whitespace can neither disguise an empty title
 * nor consume the length budget. An empty **body** is allowed and an empty **title**
 * is not: "Need a bike pump" is a complete Request, whereas a bulletin with nothing in
 * the field the board renders is a row nobody can act on.
 *
 * @returns The trimmed content, which is what gets stored — the caller must use this
 *   return value rather than its own input, or the trim is advice instead of a rule.
 * @throws {BulletinContentInvalidError} naming the field that was refused.
 */
export function validateBulletinContent(content: BulletinContent): BulletinContent {
  const title = content.title.trim();
  const body = content.body.trim();

  if (title.length === 0 || title.length > BULLETIN_TITLE_MAX_LENGTH) {
    throw new BulletinContentInvalidError('title', BULLETIN_TITLE_MAX_LENGTH);
  }
  if (body.length > BULLETIN_BODY_MAX_LENGTH) {
    throw new BulletinContentInvalidError('body', BULLETIN_BODY_MAX_LENGTH);
  }

  return { title, body };
}
