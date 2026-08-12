import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HEALTH_PATH } from '../../apps/server/src/entrypoints/http/health';
import { environmentSchema } from '../../packages/configuration/src/environment-schema';

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

/**
 * The keys `@playa-post/configuration` has no default for.
 *
 * Derived by parsing an empty environment rather than restated, so a key added to the
 * schema is covered the day it lands — a list copied here would be one more thing to
 * remember, and forgetting it is the exact failure this asserts against.
 */
function undefaultedEnvironmentKeys(): readonly string[] {
  const result = environmentSchema.safeParse({});
  if (result.success) {
    return [];
  }
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
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

  it('declares every environment key the configuration schema has no default for', () => {
    // A required key missing from the blueprint is a service that builds, starts, and
    // exits non-zero inside `loadConfiguration` — a green CI run and a dead deploy.
    // Nothing else couples this file to the schema.
    const undefaulted = undefaultedEnvironmentKeys();

    // Non-vacuity: were the schema ever to require nothing, the loop below would pass
    // by asserting nothing at all.
    expect(undefaulted.length).toBeGreaterThan(0);

    for (const key of undefaulted) {
      expect(blueprint).toMatch(new RegExp(String.raw`-[ \t]*key:[ \t]*${key}\b`));
    }
  });

  it('declares the Web Push keys, which the undefaulted-key check above cannot see', () => {
    // The parity check above derives its list from what an empty environment REJECTS,
    // and the VAPID trio is optional — absent is a supported state (the server boots on
    // the unconfigured transport). So nothing above couples these three keys to the
    // blueprint, and an operator whose deploy is silently never sending a push has no
    // failing check to read. This is that check.
    //
    // Asserted through the schema rather than as a literal list, so adding a fourth
    // `VAPID_*` key to the environment fails here until the blueprint declares it too.
    const vapidKeys = Object.keys(environmentSchema.shape).filter((key) =>
      key.startsWith('VAPID_'),
    );

    expect(vapidKeys.length).toBeGreaterThan(0);

    for (const key of vapidKeys) {
      expect(blueprint).toMatch(new RegExp(String.raw`-[ \t]*key:[ \t]*${key}\b`));
    }
  });

  it('declares no value the configuration schema would reject at boot', () => {
    // Every `value:` in this file is a string the server parses at startup and nothing
    // type-checks before then, so `PURGE_RETENTION_DAYS: thirty` or `LOG_LEVEL: verbose`
    // is a green CI run and a service that exits non-zero inside `loadConfiguration`.
    // Defaulted keys are exactly the ones at risk here: they are optional, so the
    // undefaulted-key check above cannot see them, and declaring one wrong is strictly
    // worse than leaving it out.
    //
    // Derived from the schema rather than a list, so a key added to either side is
    // covered without this test being touched. Keys Render owns (`NODE_VERSION`) are not
    // in the shape and are skipped.
    const declared = Object.fromEntries(
      [...blueprint.matchAll(/-[ \t]*key:[ \t]*(\w+)[ \t]*\n\s*value:[ \t]*(.+?)[ \t]*$/gm)].map(
        (match): [string, string] => [match[1] ?? '', unquote(match[2] ?? '')],
      ),
    );

    // Non-vacuity: a formatting change that stopped this pattern matching would otherwise
    // leave the assertion below passing against an empty environment.
    expect(Object.keys(declared).length).toBeGreaterThan(0);

    // Parsed as a whole rather than field by field, so the schema is exercised exactly as
    // boot exercises it. Issues naming keys this file does NOT declare are somebody else's
    // subject — `DATABASE_URL` is `sync: false` and therefore absent here by design, and
    // the check above already couples the undefaulted keys to the blueprint.
    const result = environmentSchema.safeParse(declared);
    const rejected = result.success
      ? []
      : [
          ...new Set(
            result.error.issues
              .map((issue) => String(issue.path[0]))
              .filter((key) => key in declared),
          ),
        ];

    expect(rejected, 'render.yaml declares a value the server would exit on').toEqual([]);
  });

  it('keeps every Web Push key out of git, values in the secret store', () => {
    // `sync: false` is how a Render blueprint says "prompt for this once and keep it".
    // The private key is a genuine secret; the public key and the contact are not, and
    // are here anyway because the pair rotates together — see the blueprint's comment.
    // A `value:` line under any of them would be a credential in source control.
    for (const key of Object.keys(environmentSchema.shape).filter((name) =>
      name.startsWith('VAPID_'),
    )) {
      expect(declaredEnvVar(key)).toBeUndefined();
      expect(blueprint).toMatch(
        new RegExp(String.raw`-[ \t]*key:[ \t]*${key}[ \t]*\n\s*sync:[ \t]*false\b`),
      );
    }
  });

  it('carries the Supabase project URL as a value, because it identifies rather than authenticates', () => {
    // The JWKS this server trusts is derived from it (ADR-0011), so this one line
    // decides whose users are accepted. `sync: false` would move that decision into
    // dashboard state no pull request can show; DATABASE_URL beside it is what a
    // genuine secret looks like. Validated with the server's own schema, so a typo is
    // caught here rather than at boot on Render.
    const declared = declaredEnvVar('SUPABASE_URL');

    expect(declared).toBeDefined();
    expect(environmentSchema.shape.SUPABASE_URL.safeParse(declared).error).toBeUndefined();
  });
});
