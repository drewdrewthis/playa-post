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
      // Deliberately-violating architecture fixtures. Linting them would either
      // fail the build or, worse, tempt someone to "fix" them and silently
      // disarm a boundary rule. See tests/fitness/__fixtures__/README.md.
      'tests/fitness/__fixtures__/**',
      // The settled UX prototype exported from claude.ai/design. Product
      // evidence, not production code (docs/engineering/repo-map.md) — it is
      // read for intent and never edited, so linting it is pure noise.
      'design/**',
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
