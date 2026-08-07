import {
  BULLETIN_BODY_MAX_LENGTH,
  BULLETIN_LOC_MAX_LENGTH,
  BULLETIN_TITLE_MAX_LENGTH,
  type BulletinContent,
  type SubmittedBulletinContent,
} from './bulletin-content';
import { BulletinContentInvalidError } from './bulletin.errors';

/**
 * Accept a submitted title, body and location, or refuse them.
 *
 * All three are trimmed first, so leading whitespace can neither disguise an empty
 * title nor consume the length budget. An empty **body** is allowed and an empty
 * **title** is not: "Need a bike pump" is a complete Request, whereas a bulletin with
 * nothing in the field the board renders is a row nobody can act on.
 *
 * ⚠ **A location that trims to nothing is stored as `null`, not as `""`.** A form that
 * submits an untouched input sends the empty string, and storing it would give the
 * board two representations of "this bulletin names no place" — one of which renders as
 * a stray separator in the `◦ {loc} · {author}` meta line.
 *
 * @returns The trimmed content, which is what gets stored — the caller must use this
 *   return value rather than its own input, or the trim is advice instead of a rule.
 * @throws {BulletinContentInvalidError} naming the field that was refused.
 */
export function validateBulletinContent(content: SubmittedBulletinContent): BulletinContent {
  const title = content.title.trim();
  const body = content.body.trim();
  const loc = content.loc === undefined ? '' : content.loc.trim();

  if (title.length === 0 || title.length > BULLETIN_TITLE_MAX_LENGTH) {
    throw new BulletinContentInvalidError('title', BULLETIN_TITLE_MAX_LENGTH);
  }
  if (body.length > BULLETIN_BODY_MAX_LENGTH) {
    throw new BulletinContentInvalidError('body', BULLETIN_BODY_MAX_LENGTH);
  }
  if (loc.length > BULLETIN_LOC_MAX_LENGTH) {
    throw new BulletinContentInvalidError('loc', BULLETIN_LOC_MAX_LENGTH);
  }

  return { title, body, loc: loc.length === 0 ? null : loc };
}
