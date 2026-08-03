import { defineConfig } from 'vitest/config';

/**
 * Vitest workspace: three projects, split by what they need to run rather than by
 * where they live (addendum §21 — "test behavior at the narrowest useful level").
 *
 * - `unit`        — no infrastructure. Domain, application, and the architecture
 *                   fitness functions. Must stay fast enough to run on save.
 * - `integration` — real Postgres via Testcontainers. Slow, serialised, and the
 *                   only place SQL correctness can actually be proven.
 * - `security`    — the ADR-0002 bypass suite. Same Testcontainers cost as
 *                   `integration`, kept separate because it is a **control**, not a
 *                   test suite: it has its own script and CI step, and its own
 *                   manifest gate. Its own *job* lands with M1b.5 (ten named jobs +
 *                   branch protection) — today it is a step inside `verify`, so it
 *                   shares that job's failure domain.
 *
 * `unit` and `integration` select on the suffix alone, so a test's cost is visible in
 * its filename and a new module needs no config change. `security` is scoped to
 * `tests/security/**` as well, deliberately: the suite is a checked-in control with a
 * manifest, not a pattern any package may opt into. ⚠ The cost of that choice is that
 * a `*.security.test.ts` written under `apps/` or `packages/` never runs — if that
 * ever becomes a real place to put one, widen the include rather than assuming the
 * suffix was enough.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'apps/**/*.unit.test.{ts,tsx}',
            'packages/**/*.unit.test.{ts,tsx}',
            'tests/fitness/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/fitness/__fixtures__/**'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/**/*.integration.test.ts', 'packages/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          // Pulling and booting a Postgres image on a cold CI runner is slow, and a
          // flaky timeout here reads as a broken migration. Be generous.
          testTimeout: 120_000,
          hookTimeout: 300_000,
          // One container at a time: parallel Testcontainers on a 2-core runner
          // contend for docker and time out rather than fail honestly.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'security',
          environment: 'node',
          include: ['tests/security/**/*.security.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
