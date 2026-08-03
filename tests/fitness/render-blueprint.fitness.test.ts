import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HEALTH_PATH } from '../../apps/server/src/entrypoints/http/health';

/**
 * Fitness function for the deployment blueprint (ADR-0009).
 *
 * `render.yaml` restates values the code also declares — the health path, the
 * bundle's location, the Node version. Nothing compiles it, so every restatement
 * is a coupling that breaks at **deploy** time rather than build time, and breaks
 * quietly: a wrong `healthCheckPath` leaves the service permanently unhealthy and
 * unrouted, a wrong `startCommand` crash-loops. Both look like a green CI run.
 *
 * ADR-0001 proved reversibility by asserting the Node and Cloudflare entrypoints
 * returned byte-identical health output. That drift died with the second
 * entrypoint; this is the drift that replaced it.
 *
 * Deliberately a text scan rather than a YAML parse: adding a YAML dependency to
 * assert five strings is more surface than the problem (addendum §18/§24). The
 * cost is that the patterns below must stay loose about formatting — hence
 * capturing to end-of-line rather than to the first space.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRepositoryFile(...segments: readonly string[]): string {
  return readFileSync(join(repositoryRoot, ...segments), 'utf8');
}

const blueprint = readRepositoryFile('render.yaml');

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Every value the blueprint declares for a top-level-ish `key:`.
 *
 * `matchAll`, not `exec`: a second service (a staging copy is a named candidate
 * in plan M4) would otherwise be validated only for its first entry while every
 * later one passed unchecked.
 *
 * Captures to end of line, not `\S+`, because `startCommand` contains spaces.
 * A trailing `# comment` therefore lands *inside* the captured value and fails
 * the assertion showing the comment — loud and diagnosable, rather than the
 * silent `undefined` a stricter anchor would produce.
 */
function declaredValues(key: string): readonly string[] {
  const pattern = new RegExp(String.raw`^\s*${key}:[ \t]*(.+?)[ \t]*$`, 'gm');
  return [...blueprint.matchAll(pattern)].map((match) => unquote(match[1] ?? ''));
}

/** The value of an `- key: NAME` / `value: X` pair in an `envVars` block. */
function declaredEnvVar(name: string): string | undefined {
  const pattern = new RegExp(String.raw`-[ \t]*key:[ \t]*${name}[ \t]*\n\s*value:[ \t]*(.+?)[ \t]*$`, 'm');
  const captured = pattern.exec(blueprint)?.[1];
  return captured === undefined ? undefined : unquote(captured);
}

function serverPackageMain(): string {
  const parsed = JSON.parse(readRepositoryFile('apps', 'server', 'package.json')) as {
    main: string;
  };
  return parsed.main;
}

describe('render.yaml (ADR-0009)', () => {
  it('polls the health path the server actually mounts', () => {
    const declared = declaredValues('healthCheckPath');

    expect(declared).not.toHaveLength(0);
    for (const path of declared) {
      expect(path).toBe(HEALTH_PATH);
    }
  });

  it('starts the bundle the server package declares as its artifact', () => {
    // package.json's `main` is the artifact path of record — tsup writes it and
    // `pnpm start` runs it. The blueprint must name that same file; a mismatch is
    // a crash-loop with no failing build.
    const artifact = join('apps/server', serverPackageMain());

    expect(declaredValues('startCommand')).toEqual([`node ${artifact}`]);
  });

  it('expects the artifact where tsup actually writes it', () => {
    // Closes the loop: `main` is only trustworthy if the bundler emits there.
    const outDir = /outDir:[ \t]*'([^']+)'/.exec(readRepositoryFile('apps', 'server', 'tsup.config.ts'))?.[1];

    expect(outDir).toBeDefined();
    expect(serverPackageMain().replace(/^\.\//, '')).toMatch(new RegExp(`^${outDir}/`));
  });

  it('pins the Node major the repository pins', () => {
    // `.nvmrc` is what developers and CI use. A blueprint on a different major is
    // a production-only toolchain nothing tested against.
    expect(declaredEnvVar('NODE_VERSION')).toBe(readRepositoryFile('.nvmrc').trim());
  });

  it('binds a reachable host — 127.0.0.1 is unroutable from outside the container', () => {
    expect(declaredEnvVar('HOST')).toBe('0.0.0.0');
  });
});
