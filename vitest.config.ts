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
 *                   test suite: it has its own CI job so it can never be skipped as
 *                   part of "the slow tests", and its own manifest gate.
 *
 * The suffix (`*.unit.test.ts` / `*.integration.test.ts` / `*.security.test.ts`) is
 * the selector, so a test's cost is visible in its filename and a new module needs
 * no config change.
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
