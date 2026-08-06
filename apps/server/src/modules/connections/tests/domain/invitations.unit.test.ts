import { describe, expect, it } from 'vitest';

// `../../domain/invite-token` does not exist yet. That is the point: this file fails
// on module resolution until the coder writes `generateInviteToken`, which is the
// legible failure the L2 test-writing brief asks for at this seam.
import {
  generateInviteToken,
  type InviteTokenSubject,
  type RandomTokenSource,
} from '../../domain/invite-token';
import { nodeCryptoRandomToken } from '../../infrastructure/node-crypto-random-token';

/**
 * `specs/features/invitations.feature` — the three `@unit` scenarios, M2-AC17.
 *
 * M2-AC17's evidence clause: "quoted generator unit-test output, quoted distinctness
 * count" — the generator itself is asserted here; the fitness rule half of AC17
 * ("a fitness rule failing any non-CSPRNG source in that module") lives at
 * `tests/fitness/invite-token-csprng.fitness.test.ts`, because a fitness rule over a
 * module's source is architecture, not domain behavior, and belongs in the fitness
 * suite alongside `no-sql-outside-persistence` and `no-container-outside-composition`.
 */
describe('invite token generator (invitations.feature, M2-AC17)', () => {
  // `satisfies` rather than a type annotation. `InviteTokenSubject.handle` is optional
  // — the real caller, `create-invite.service.ts`, holds only the inviter's ID and
  // would have to reach into `modules/identity` to obtain a handle — so annotating
  // this fixture would widen `handle` to `string | undefined` and the four assertions
  // below could not read it. `satisfies` still proves the fixture conforms to the
  // type; it just keeps the literal's own narrower shape.
  const subject = {
    id: '3f2b6b0a-2f0a-4a3c-9a3f-9d9a2a6b7c11',
    handle: 'dusty_wanderer',
  } satisfies InviteTokenSubject;

  describe('Scenario: Invite token generator uses a CSPRNG source', () => {
    it('calls a CSPRNG with at least 16 bytes of entropy', () => {
      // Observed through the domain's own `RandomTokenSource` port, not by patching
      // `node:crypto`.
      //
      // ⚠ The original spelling of this test was `vi.spyOn(await import('node:crypto'),
      // 'randomBytes')`, and it cannot work: an ESM module namespace is not
      // configurable, so Vitest throws `Cannot spy on export "randomBytes"` before any
      // assertion runs. That is a property of ESM rather than of this generator — no
      // implementation could have satisfied it.
      //
      // The recorder **delegates to the real adapter**, so this is not a fake standing
      // in for a CSPRNG: `nodeCryptoRandomToken` is the same `node:crypto` binding the
      // production default parameter uses, and the token asserted below is the one it
      // produced. What the port adds is the ability to see the byte count going in.
      const requestedByteLengths: number[] = [];
      const recordingSource: RandomTokenSource = (byteLength) => {
        requestedByteLengths.push(byteLength);
        return nodeCryptoRandomToken(byteLength);
      };

      const token = generateInviteToken(subject, recordingSource);

      expect(requestedByteLengths).toHaveLength(1);
      const requestedBytes = requestedByteLengths[0] ?? -1;
      expect(requestedBytes).toBeGreaterThanOrEqual(16);

      // Every requested byte reaches the token: unpadded base64url is 4 characters per
      // 3 bytes, so a generator that asked for 32 bytes and returned a truncated
      // 16-byte string would fail here rather than quietly halving the entropy.
      expect(token).toHaveLength(Math.ceil((requestedBytes * 4) / 3));
    });
  });

  describe('Scenario: Ten thousand generated tokens are all distinct', () => {
    it('produces 10000 distinct tokens, each passing the length and charset assertion', () => {
      const tokens = Array.from({ length: 10_000 }, () => generateInviteToken(subject));

      expect(new Set(tokens).size).toBe(10_000);

      // Opaque and URL-safe: base64url charset, at minimum the 16-byte CSPRNG floor
      // encoded (22 chars unpadded). Anything narrower would be easier to guess.
      const tokenShape = /^[A-Za-z0-9_-]{22,}$/;
      for (const token of tokens) {
        expect(token).toMatch(tokenShape);
      }
    });
  });

  describe("Scenario: Generated token does not encode the inviter's identity", () => {
    it("is not a prefix, suffix, or encoding of the user's ID", () => {
      const token = generateInviteToken(subject);

      expect(token.startsWith(subject.id)).toBe(false);
      expect(token.endsWith(subject.id)).toBe(false);
      expect(token).not.toContain(subject.id);
      expect(token).not.toContain(Buffer.from(subject.id).toString('base64url'));
      expect(token).not.toContain(
        Buffer.from(subject.id.replaceAll('-', ''), 'hex').toString('base64url'),
      );
    });

    it("is not a prefix, suffix, or encoding of the user's handle", () => {
      const token = generateInviteToken(subject);

      expect(token.toLowerCase().startsWith(subject.handle.toLowerCase())).toBe(false);
      expect(token.toLowerCase().endsWith(subject.handle.toLowerCase())).toBe(false);
      expect(token.toLowerCase()).not.toContain(subject.handle.toLowerCase());
      expect(token).not.toContain(Buffer.from(subject.handle).toString('base64url'));
    });
  });
});
