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
 * discipline: this walks `modules/connections/domain/invite-token.ts` only, not every
 * file that happens to call `Math.random` — a repo-wide ban is a different, larger
 * rule nobody has asked for yet.
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
});
