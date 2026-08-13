import { describe, expect, it } from 'vitest';

import { CONNECTION_REQUEST_DECISION } from '../../domain/connection-request';
import {
  decideConnectionRequestCommandFields,
  decideConnectionRequestInput,
} from '../../transport/decide-connection-request.input';
import { personalLinkSlugInput } from '../../transport/personal-link-slug.input';

/**
 * What the two new wire schemas accept and — more importantly — refuse (issue #206).
 */
const OWNER_ID = '11111111-1111-4111-8111-111111111111';

describe('connections.requests.decide input', () => {
  const id = '33333333-3333-4333-8333-333333333333';

  it('accepts an accept and a decline', () => {
    for (const decision of Object.values(CONNECTION_REQUEST_DECISION)) {
      expect(
        decideConnectionRequestInput.safeParse({ connectionRequestId: id, decision }).success,
      ).toBe(true);
    }
  });

  /*
   * ⚠ **Refused, not stripped.** Zod's default object silently drops unknown keys, and the
   * field somebody will eventually try to send here is a note — "let me tell them why".
   * Nobody would read it: an acceptance is disclosed by the connection it makes, and a
   * decline is never disclosed at all. A field the server discarded in silence would let its
   * writer believe it was kept.
   */
  it('refuses a note rather than dropping it', () => {
    const parsed = decideConnectionRequestInput.safeParse({
      connectionRequestId: id,
      decision: CONNECTION_REQUEST_DECISION.decline,
      note: 'nothing personal',
    });

    expect(parsed.success).toBe(false);
  });

  /*
   * ⚠ A caller says what they are *doing*; the server decides what that stores. A `status`
   * field would let a client post `'accepted'` and name their own outcome.
   */
  it('refuses a self-named status', () => {
    expect(
      decideConnectionRequestInput.safeParse({
        connectionRequestId: id,
        decision: CONNECTION_REQUEST_DECISION.accept,
        status: 'accepted',
      }).success,
    ).toBe(false);
  });

  it('refuses every spelling of an actor identifier (ADR-0002:180-181)', () => {
    for (const field of ['viewerId', 'userId', 'actorId', 'ownerId', 'requesterId']) {
      expect(
        decideConnectionRequestInput.safeParse({
          connectionRequestId: id,
          decision: CONNECTION_REQUEST_DECISION.accept,
          [field]: OWNER_ID,
        }).success,
        `${field} must be refused`,
      ).toBe(false);
    }
  });

  it('refuses a decision it does not know', () => {
    expect(
      decideConnectionRequestInput.safeParse({ connectionRequestId: id, decision: 'pass_on' })
        .success,
    ).toBe(false);
  });

  it('refuses an id that is not a uuid', () => {
    expect(
      decideConnectionRequestInput.safeParse({
        connectionRequestId: 'not-a-uuid',
        decision: CONNECTION_REQUEST_DECISION.accept,
      }).success,
    ).toBe(false);
  });

  describe('decideConnectionRequestCommandFields', () => {
    it('carries the two fields and never an actor', () => {
      const fields = decideConnectionRequestCommandFields({
        connectionRequestId: id,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });

      expect(fields).toEqual({
        connectionRequestId: id,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });
    });
  });
});

describe('the personal-link slug input', () => {
  /*
   * ⚠ **`z.string()` and nothing more, deliberately.** Restating the charset or the length
   * here would let a malformed slug come back as a generic `BAD_REQUEST` while a well-formed
   * but unknown one came back as `PERSONAL_LINK_UNAVAILABLE` — an oracle for "was that ever
   * the shape of a real link", assembled out of two refusals that each looked reasonable
   * alone.
   */
  it('accepts any string, so every non-slug gets the same refusal from the server', () => {
    for (const slug of ['', '   ', 'not base64url!!', 'a'.repeat(500), '../../etc/passwd']) {
      expect(personalLinkSlugInput.safeParse({ slug }).success, slug).toBe(true);
    }
  });

  it('refuses a missing slug and a non-string one', () => {
    expect(personalLinkSlugInput.safeParse({}).success).toBe(false);
    expect(personalLinkSlugInput.safeParse({ slug: 42 }).success).toBe(false);
  });

  /*
   * ⚠ **No `ownerId`, ever.** A procedure that took one would be a way to request a
   * connection with anybody whose id you could guess, which is the whole thing the link
   * exists to prevent. The default (non-strict) object strips it rather than refusing, so
   * what is asserted is that it never reaches the parsed value.
   */
  it('never carries an owner identifier through to the parsed value', () => {
    const parsed = personalLinkSlugInput.parse({ slug: 'abc', ownerId: OWNER_ID });

    expect(parsed).toEqual({ slug: 'abc' });
  });
});
