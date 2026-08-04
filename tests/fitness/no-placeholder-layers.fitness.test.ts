import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Fitness function for architecture-addendum §4 / M1-AC13.
 *
 * `apps/server/src/modules/` does not exist yet — M1 ships no product code, and the
 * addendum forbids creating a layer directory ahead of the file that justifies it. This
 * suite is therefore vacuous today by construction (see the first `it` below) and
 * becomes load-bearing the moment M2 creates the first module.
 *
 * "Placeholder" is read from the AC text: a directory under `modules/` with no file
 * directly inside it that carries a non-trivial export — comment-only bodies, `export {}`,
 * and an empty re-export (`export {} from './x'`) all count as placeholders. A `.sql` file
 * (e.g. under a module's `persistence/sql/`) has no export syntax at all, so it is judged
 * only on non-emptiness rather than the export-shaped rule below — the point is "a real
 * file landed here" (addendum §4), not "every directory holds TypeScript."
 *
 * A directory that holds only subdirectories (no file of its own) also counts as a
 * placeholder — every layer in the addendum's own shape carries at least one direct file
 * (e.g. `<name>.module.ts` at a module's root), so an organisational-only directory is
 * exactly the premature scaffold §4 forbids, not a legitimate exception.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesRoot = join(repositoryRoot, 'apps', 'server', 'src', 'modules');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** An empty export list, with or without a re-export source — "a re-export of nothing". */
// Matches a single-line empty-export statement only; a file with two separate empty-export statements would slip past. Known, accepted.
const EMPTY_EXPORT_PATTERN = /^export\s*\{\s*\}(\s*from\s*['"][^'"]*['"])?\s*;?$/;

/**
 * Deliberately a text scan, not a TypeScript parse — the three placeholder shapes the AC
 * names are simple enough that a full AST is more surface than the problem (addendum
 * §18/§24), matching render-blueprint.fitness.test.ts's own tradeoff.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function isPlaceholderSource(contents: string): boolean {
  const stripped = stripComments(contents).trim();
  return stripped === '' || EMPTY_EXPORT_PATTERN.test(stripped);
}

/** Non-source files (e.g. `.sql`) have no export syntax — judged on content alone. */
function isPlaceholderFile(path: string): boolean {
  const contents = readFileSync(path, 'utf8');
  return SOURCE_EXTENSIONS.has(extname(path)) ? isPlaceholderSource(contents) : contents.trim() === '';
}

/** Every directory strictly under `root` (not `root` itself), at any depth. */
function directoriesUnder(root: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const childPath = join(dir, entry.name);
        found.push(childPath);
        walk(childPath);
      }
    }
  }
  walk(root);
  return found;
}

function hasRealFile(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .some((entry) => !isPlaceholderFile(join(dir, entry.name)));
}

const modulesRootExists = existsSync(modulesRoot);

describe('no placeholder layers (addendum §4, M1-AC13)', () => {
  it.skipIf(modulesRootExists)('is vacuous until apps/server/src/modules exists — first load-bearing at M2', () => {
    expect(modulesRootExists).toBe(false);
  });

  it.runIf(modulesRootExists)('fails on any directory with no file carrying a non-trivial export', () => {
    const placeholders = directoriesUnder(modulesRoot)
      .filter((dir) => !hasRealFile(dir))
      .map((dir) => relative(repositoryRoot, dir));

    expect(placeholders).toEqual([]);
  });
});
