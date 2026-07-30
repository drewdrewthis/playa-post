import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/entrypoints/http/main.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they must be bundled rather
  // than left as runtime requires that Node cannot resolve.
  noExternal: [/^@playa-post\//],
});
