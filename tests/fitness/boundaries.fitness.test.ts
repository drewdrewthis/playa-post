import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Fitness function for architecture-addendum §19.
 *
 * A boundary rule nobody has watched fail is a rule you are trusting on faith.
 * This suite runs the same `dependency-cruiser` binary CI runs, twice: once over
 * the real tree (must be clean) and once over `__fixtures__/` (each rule must be
 * caught by the fixture named after it, and by nothing else).
 *
 * It deliberately shells out rather than calling the programmatic API, so that a
 * change to the CLI, the config file, or how they find each other fails here
 * rather than passing a test while breaking `pnpm boundaries`.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesRoot = join(repositoryRoot, 'tests', 'fitness', '__fixtures__');
const configurationPath = join(repositoryRoot, '.dependency-cruiser.cjs');
const dependencyCruiserBinary = join(repositoryRoot, 'node_modules', '.bin', 'depcruise');

interface Violation {
  readonly rule: { readonly name: string; readonly severity: string };
  readonly from: string;
  readonly to: string;
}

interface CruiseOutcome {
  readonly violations: readonly Violation[];
  readonly totalCruised: number;
}

const require = createRequire(import.meta.url);
const configuration = require(configurationPath) as {
  forbidden: readonly { name: string; severity: string; comment?: string }[];
};
const ruleNames: readonly string[] = configuration.forbidden.map((rule) => rule.name);

/**
 * Run dependency-cruiser exactly as `pnpm boundaries` does — default reporter,
 * no JSON — and return only its exit code. This is the assertion that matters for
 * CI: the JSON reporter always exits 0, so a test that only reads JSON would pass
 * happily while the build stopped failing on boundary breaks.
 */
function cruiseExitCode(targets: readonly string[]): number | null {
  const result = spawnSync(
    dependencyCruiserBinary,
    ['--config', configurationPath, ...targets],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error !== undefined) {
    throw result.error;
  }
  return result.status;
}

function cruise(targets: readonly string[]): CruiseOutcome {
  const result = spawnSync(
    dependencyCruiserBinary,
    ['--config', configurationPath, '--output-type', 'json', ...targets],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.stdout === '') {
    throw new Error(`dependency-cruiser produced no output. stderr:\n${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    summary: { violations: Violation[]; totalCruised: number };
  };

  return {
    violations: parsed.summary.violations,
    totalCruised: parsed.summary.totalCruised,
  };
}

/** The fixture directory a violation was found in, or undefined if it is outside the fixtures. */
function owningFixture(violation: Violation): string | undefined {
  const prefix = 'tests/fitness/__fixtures__/';
  if (!violation.from.startsWith(prefix)) {
    return undefined;
  }
  return violation.from.slice(prefix.length).split('/')[0];
}

describe('boundary rules (addendum §19)', () => {
  it('declares at least the five checks the addendum requires as a minimum', () => {
    expect(ruleNames).toEqual(
      expect.arrayContaining([
        'no-domain-to-infrastructure',
        'no-application-to-transport',
        'no-transport-to-persistence',
        'no-web-to-server-internals',
        'no-cross-module-persistence',
      ]),
    );
  });

  describe('against the real tree', () => {
    let outcome: CruiseOutcome;

    beforeAll(() => {
      outcome = cruise(['apps', 'packages']);
    });

    it('reports no violations', () => {
      expect(outcome.violations).toEqual([]);
    });

    it('exits zero, so `pnpm boundaries` passes on a clean tree', () => {
      expect(cruiseExitCode(['apps', 'packages'])).toBe(0);
    });

    it('actually parsed the source — a green run over zero files proves nothing', () => {
      expect(outcome.totalCruised).toBeGreaterThan(0);
    });
  });

  describe('against the deliberately-violating fixtures', () => {
    let outcome: CruiseOutcome;

    beforeAll(() => {
      outcome = cruise([fixturesRoot]);
    });

    it.each(ruleNames)('has a fixture directory for %s', (ruleName) => {
      expect(existsSync(join(fixturesRoot, ruleName))).toBe(true);
    });

    it('has no fixture directory that is not named after a rule', () => {
      const fixtureDirectories = readdirSync(fixturesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      expect(fixtureDirectories.sort()).toEqual([...ruleNames].sort());
    });

    it.each(ruleNames)('flags %s', (ruleName) => {
      const flagged = outcome.violations.filter(
        (violation) => violation.rule.name === ruleName && owningFixture(violation) === ruleName,
      );

      expect(
        flagged,
        `Fixture tests/fitness/__fixtures__/${ruleName}/ no longer trips its rule — ` +
          `either the rule stopped working or the fixture was "fixed".`,
      ).not.toHaveLength(0);
    });

    it('trips each rule only from its own fixture, so no rule is masking another', () => {
      const misattributed = outcome.violations.filter(
        (violation) => owningFixture(violation) !== violation.rule.name,
      );

      expect(misattributed).toEqual([]);
    });

    it('exits non-zero, which is what makes CI fail on a boundary break', () => {
      expect(cruiseExitCode([fixturesRoot])).not.toBe(0);
    });
  });
});
