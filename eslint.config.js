import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint is the *second* boundary tool, not the first.
 *
 * Module-graph rules live in `.dependency-cruiser.cjs`, because they are about
 * edges between directories and dependency-cruiser can see the whole graph.
 * ESLint owns what it is better at: per-file correctness and import hygiene.
 * Keeping the two from overlapping is deliberate — one rule enforced in two
 * places is one rule that will eventually disagree with itself.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/coverage/**',
      // Scratch state the Supabase CLI writes while the local stack is up —
      // including a bundled edge-runtime `index.ts`. Gitignored, so it is
      // invisible until someone runs `pnpm db:start`, at which point `pnpm lint`
      // reports ~190 errors in a file nobody wrote. ESLint does not read
      // `.gitignore`, so the ignore has to be restated here.
      'supabase/.temp/**',
      // Deliberately-violating architecture fixtures. Linting them would either
      // fail the build or, worse, tempt someone to "fix" them and silently
      // disarm a boundary rule. See tests/fitness/__fixtures__/README.md.
      //
      // Three roots, because they belong to three different tools: `__fixtures__/` is
      // dependency-cruiser's, and `boundaries.fitness.test.ts` asserts that every
      // directory in it is named after a dependency-cruiser rule — so the
      // `no-sql-outside-persistence` and `invite-token-csprng` fixtures cannot live
      // there and get their own sibling roots instead.
      'tests/fitness/__fixtures__/**',
      'tests/fitness/sql-fixtures/**',
      'tests/fitness/csprng-fixtures/**',
      // The settled UX prototype exported from claude.ai/design. Product
      // evidence, not production code (docs/engineering/repo-map.md) — it is
      // read for intent and never edited, so linting it is pure noise.
      'design/**',
      // Playwright's own generated output (L5, vertical-slice-e2e): bundled,
      // minified trace-viewer JS under `playwright-report/trace/`. Same trap as
      // `supabase/.temp/**` above — gitignored, invisible until someone runs
      // `pnpm test:e2e`, at which point `pnpm lint` reports thousands of errors in
      // a file nobody wrote.
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['tsconfig.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        }),
      ],
    },
    rules: {
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'import-x/no-absolute-path': 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/order': [
        'error',
        {
          // No separate `type` group on purpose: a type-only import belongs beside
          // the module it names, not exiled to the bottom where its origin is
          // harder to see.
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          pathGroups: [{ pattern: '@playa-post/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
      // A type-only import is a design signal: it says "I need the shape, not the
      // thing". Making it explicit keeps runtime edges honest, which is what the
      // boundary rules are reasoning about.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },

  {
    files: [
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      'tests/**/*.ts',
      '*.config.ts',
      'apps/*/*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
);
