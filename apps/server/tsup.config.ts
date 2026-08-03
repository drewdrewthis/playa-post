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
});
