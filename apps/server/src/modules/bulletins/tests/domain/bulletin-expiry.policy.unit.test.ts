import { describe, expect, it } from 'vitest';

import { validateBulletinExpiry } from '../../domain/bulletin-expiry.policy';
import { BulletinExpiryInvalidError } from '../../domain/bulletin.errors';

/**
 * `validateBulletinExpiry` — compose's `EXPIRES` chip group, as a rule.
 *
 * The clock is a parameter, so the boundary case ("expiring exactly now") is a test
 * rather than a race.
 */
describe('validateBulletinExpiry', () => {
  const now = new Date('2026-08-24T18:00:00.000Z');

  it('is null when no expiry was submitted — never expiring is the default', () => {
    expect(validateBulletinExpiry(undefined, now)).toBeNull();
  });

  it('is null when an explicit null was submitted', () => {
    expect(validateBulletinExpiry(null, now)).toBeNull();
  });

  it('accepts a moment in the future and returns it unchanged', () => {
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    expect(validateBulletinExpiry(inThreeDays, now)).toEqual(inThreeDays);
  });

  it('refuses a moment that has already passed', () => {
    // Otherwise the bulletin commits, emits BulletinCreated, notifies everyone whose
    // saved query matches — and is invisible on every board including its author's.
    expect(() => validateBulletinExpiry(new Date(now.getTime() - 1000), now)).toThrow(
      BulletinExpiryInvalidError,
    );
  });

  it('refuses a moment of exactly now', () => {
    // `expires_at > now()` in app.visible_bulletins is already false at this instant,
    // so accepting it would store a bulletin nobody can ever see.
    expect(() => validateBulletinExpiry(new Date(now.getTime()), now)).toThrow(
      BulletinExpiryInvalidError,
    );
  });

  it('refuses it with the stable BULLETIN_EXPIRY_INVALID code, distinct from a length refusal', () => {
    // A client shows this beside the expiry control and BULLETIN_CONTENT_INVALID beside
    // a text input, which is only possible if the two are distinguishable without
    // reading prose.
    expect(() => validateBulletinExpiry(new Date(now.getTime() - 1), now)).toThrow(
      expect.objectContaining({ code: BulletinExpiryInvalidError.code }),
    );
  });

  it('imposes no maximum horizon — the presets are a UI affordance, not a wire contract', () => {
    const inAYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    expect(validateBulletinExpiry(inAYear, now)).toEqual(inAYear);
  });
});
