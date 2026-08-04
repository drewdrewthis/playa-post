import { defineConfig } from 'tsup';

/**
 * One bundle, for the one deployment target.
 *
 * ADR-0009: the backend deploys as this Node build to Render. The second
 * (`workerd`) bundle ADR-0001 required is deleted — with a single live target,
 * building an artifact nobody deploys is not reversibility, it is maintenance of
 * a fiction. Portability is preserved by the boundary rules instead: runtime code
 * exists only under `entrypoints/**` and infrastructure adapters, and
 * `no-domain-to-infrastructure` fails the build on a violation.
 *
 * Workspace packages ship TypeScript source, so the bundle must inline them
 * rather than leave runtime requires that Node cannot resolve.
 *
 * `dist/node/main.js` is the path `render.yaml`'s start command and
 * `package.json`'s `main` both point at — moving it means moving them.
 */
export default defineConfig({
  name: 'node',
  entry: { main: 'src/entrypoints/http/main.ts' },
  outDir: 'dist/node',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@playa-post\//],
  // Reproduced on Render (dep-d9p1k2rl550s73fka230): the bundle crashed at boot with
  // `Error: Dynamic require of "events" is not supported`. esbuild's ESM output
  // replaces every bundled CJS module's `require` with a shim that throws unless a
  // real `require` is already in scope — and `pg` (CJS) calls `require('events')` at
  // module load. `tests/fitness/server-bundle-boot.fitness.test.ts` is the check that
  // would have caught this: `pnpm build:server:node` succeeds either way, because
  // nothing in CI's build job executes the bundle.
  //
  // The fix: bind a real `require` at module scope via `createRequire`, which
  // esbuild's shim detects at runtime (`typeof require !== "undefined"`) and defers
  // to instead of throwing. Verified against this exact tsup/esbuild pin — see the
  // fitness test above, which failed against the un-bannered config and passes with
  // it.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
