import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `find-non-csprng-random-source` does not exist yet — it ships with the rule, the
// same way `find-sql-outside-persistence.ts` shipped with `no-sql-outside-persistence`
// (that file's own docstring: "M1b.9's second half"). This import failing to resolve
// is the legible failure for this seam.
import { findNonCsprngRandomSources } from './find-non-csprng-random-source';

/**
 * Fitness function for the CSPRNG half of M2-AC17 (invitations.feature, "Invite token
 * generator uses a CSPRNG source"): "a fitness rule fails any non-CSPRNG source in
 * that module."
 *
 * `modules/connections/domain/invite-token.ts` may call `node:crypto`'s
 * `randomBytes`/`randomUUID` and nothing else that produces randomness —
 * `Math.random`, `Date.now()`-seeded values, or any non-cryptographic RNG fails this
 * rule wherever it appears inside the invite-token source file.
 *
 * Deliberately narrow, mirroring `no-sql-outside-persistence`'s own scoping
 * discipline: this walks the module's **token-and-slug generators** only, not every
 * file that happens to call `Math.random` — a repo-wide ban is a different, larger
 * rule nobody has asked for yet.
 *
 * ⚠ **`domain/personal-link.ts` is the second file in scope** (issue #206). A personal
 * link's slug is drawn from the same `RandomTokenSource` port, and its entropy
 * requirement is weaker than a token's — anti-enumeration rather than anti-forgery — so
 * it is precisely the generator somebody could "simplify" to a timestamp or a
 * `Math.random` id without feeling they had touched a credential. Adding the path here
 * costs one line; noticing that omission in review is not something to rely on.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inviteTokenSource = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'connections',
  'domain',
  'invite-token.ts',
);
const personalLinkSource = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'connections',
  'domain',
  'personal-link.ts',
);
const violatingFixture = join(
  repositoryRoot,
  'tests',
  'fitness',
  'csprng-fixtures',
  'non-csprng-invite-token.ts',
);

describe('invite-token CSPRNG fitness rule (M2-AC17)', () => {
  describe('against a deliberately-violating fixture using Math.random', () => {
    it('flags the non-CSPRNG source', () => {
      const violations = findNonCsprngRandomSources([violatingFixture]);

      expect(violations).not.toHaveLength(0);
      expect(
        violations.some((violation) => violation.file.includes('non-csprng-invite-token.ts')),
      ).toBe(true);
    });
  });

  describe('against the real invite-token module', () => {
    it('reports no violation once the generator exists and uses only node:crypto', () => {
      const violations = findNonCsprngRandomSources([inviteTokenSource]);

      expect(violations).toEqual([]);
    });
  });

  describe('against the real personal-link module (issue #206)', () => {
    it('reports no violation — the slug is drawn from the same CSPRNG port', () => {
      const violations = findNonCsprngRandomSources([personalLinkSource]);

      expect(violations).toEqual([]);
    });
  });

  describe('both generators together', () => {
    // Asserted over both paths in one call, so the rule cannot pass merely because each
    // file was checked by a test that only ever looks at one of them — the shape that
    // lets a third generator be added and watched by nothing.
    it('walks every randomness source this module mints identifiers from', () => {
      expect(findNonCsprngRandomSources([inviteTokenSource, personalLinkSource])).toEqual([]);
    });
  });
});
