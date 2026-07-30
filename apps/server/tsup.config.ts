import { defineConfig, type Options } from 'tsup';

/**
 * Two bundles, one per deployment target.
 *
 * ADR-0001 rule 2: **both server entrypoints build in CI from day one**, even
 * after a "go" verdict, because a target that is never built is a target that
 * rots — and a rotted target turns a reversible decision into a one-way door.
 * These back the `build:server:node` and `build:server:cloudflare` jobs the
 * implementation plan names.
 *
 * Workspace packages ship TypeScript source, so both bundles must inline them
 * rather than leave runtime requires that Node (or workerd) cannot resolve.
 *
 * One config, selected by `TSUP_TARGET`, rather than one config file per target:
 * two files would be two places for the shared options to drift apart.
 */
const targets = {
  node: {
    name: 'node',
    entry: { main: 'src/entrypoints/http/main.ts' },
    outDir: 'dist/node',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    clean: true,
    noExternal: [/^@playa-post\//],
  },

  cloudflare: {
    name: 'cloudflare',
    entry: { worker: 'src/entrypoints/http/cloudflare-worker.ts' },
    outDir: 'dist/cloudflare',
    format: ['esm'],
    // `neutral` is the workerd-honest target: no Node builtins are assumed and no
    // browser shims are injected. If this entrypoint ever reaches for `fs`,
    // `path`, or a Node-only dependency, this build is what fails.
    platform: 'neutral',
    target: 'es2022',
    sourcemap: true,
    clean: true,
    noExternal: [/^@playa-post\//],
    esbuildOptions(options) {
      // Resolve the way workerd does, so a dependency shipping a Node-only
      // "main" alongside a clean "workerd"/"browser" build is picked correctly —
      // and one shipping neither fails here rather than in production.
      options.conditions = ['workerd', 'browser', 'import', 'module', 'default'];
      options.mainFields = ['module', 'main'];
    },
  },
} satisfies Record<string, Options>;

type TargetName = keyof typeof targets;

function selectedTargets(): Options[] {
  const requested = process.env['TSUP_TARGET'];

  if (requested === undefined) {
    return Object.values(targets);
  }
  if (!(requested in targets)) {
    throw new Error(
      `Unknown TSUP_TARGET "${requested}". Expected one of: ${Object.keys(targets).join(', ')}.`,
    );
  }
  return [targets[requested as TargetName]];
}

export default defineConfig(selectedTargets());
