import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

/**
 * The invite-token CSPRNG walker — M2-AC17's "a fitness rule fails any non-CSPRNG
 * source in that module".
 *
 * `dependency-cruiser` sees import *edges* and would happily approve
 * `Math.random().toString(36)`: no forbidden module is named, no boundary is crossed,
 * and the token is worthless. This is a rule about which *values* a generator is built
 * from, so it parses rather than greps — the same reasoning
 * `find-sql-outside-persistence.ts` gives for its own walker.
 *
 * **Scope: the files it is handed, plus their local import closure.** That second half
 * is what keeps the rule honest. `node:crypto` may not be imported from `domain/`
 * (`.dependency-cruiser.cjs`'s `no-domain-to-infrastructure` — its own comment names
 * this token as the first real instance), so the CSPRNG necessarily lives one file
 * away in an adapter. A rule that stopped at `domain/invite-token.ts` would therefore
 * be looking at the one file guaranteed to contain no randomness at all, and would
 * report green forever — the vacuous-green failure this repo already designs against.
 * Following relative imports means the randomness cannot be evaded by moving it.
 *
 * **What counts as a non-CSPRNG source**, listed rather than inferred:
 *
 * - `Math.random` — the archetype, and a PRNG seeded from the process.
 * - `Date.now`, `performance.now`, `process.hrtime` — clock reads. Not random at all;
 *   they appear in home-made token generators as the "unique" half and make a token
 *   guessable to anyone who knows roughly when it was minted.
 * - A randomness API imported from any package other than Node's own `crypto`. A
 *   generic ID library is built for collision resistance, not for unguessability, and
 *   an invite token is a bearer credential.
 *
 * `node:crypto` (and its bare `crypto` spelling, which resolves to the same builtin)
 * is the only permitted source. Its `randomBytes` and `randomUUID` are CSPRNGs.
 *
 * Known limits, stated rather than discovered: destructuring (`const { random } =
 * Math`) and dynamic property access (`Math['random']`) are not detected, and neither
 * is an indirection through a package that re-exports one of these. The rule catches
 * what somebody writes when they are not thinking about it, which is the case it
 * exists for; it is not an adversarial control.
 */

/** One non-CSPRNG source of randomness where a token is being built. */
export interface NonCsprngRandomSource {
  /** Absolute path of the offending file. */
  readonly file: string;
  /** 1-based line of the expression. */
  readonly line: number;
  /** What was flagged — `Math.random`, `nanoid`, and so on. */
  readonly source: string;
}

/** Objects whose named property is a non-cryptographic source of "randomness". */
const FORBIDDEN_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['Math', new Set(['random'])],
  ['Date', new Set(['now'])],
  ['performance', new Set(['now'])],
  ['process', new Set(['hrtime'])],
]);

/** Module specifiers whose randomness APIs are cryptographically secure. */
const CSPRNG_MODULES = new Set(['node:crypto', 'crypto']);

/**
 * Imported names that produce randomness.
 *
 * Only consulted for **package** imports. A relative import is followed instead, so a
 * local helper called `nodeCryptoRandomToken` is judged on what it actually does
 * rather than on having "random" in its name.
 */
const RANDOM_EXPORT_NAMES = new Set([
  'customAlphabet',
  'getRandomValues',
  'nanoid',
  'rand',
  'random',
  'randomBytes',
  'randomInt',
  'randomUUID',
  'uuid',
  'uuidv4',
  'v4',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** Resolve a relative import specifier onto a real file, or `undefined` if it is not one. */
function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return undefined;
}

/** Every `.ts` file under a directory, recursively. A file path yields itself. */
function sourceFilesUnder(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  if (statSync(path).isFile()) {
    return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)) ? [path] : [];
  }

  const found: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    found.push(...sourceFilesUnder(join(path, entry.name)));
  }
  return found;
}

interface ScanResult {
  readonly violations: readonly NonCsprngRandomSource[];
  /** Relative imports to follow, already resolved to absolute paths. */
  readonly localImports: readonly string[];
}

function scanSource(absolutePath: string, contents: string): ScanResult {
  const source = ts.createSourceFile(absolutePath, contents, ts.ScriptTarget.Latest, true);
  const violations: NonCsprngRandomSource[] = [];
  const localImports: string[] = [];

  const report = (node: ts.Node, name: string): void => {
    violations.push({
      file: absolutePath,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      source: name,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const local = resolveRelativeImport(absolutePath, specifier);

      if (local !== undefined) {
        localImports.push(local);
      } else if (!CSPRNG_MODULES.has(specifier)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (RANDOM_EXPORT_NAMES.has(imported)) {
              report(element, `${imported} from ${specifier}`);
            }
          }
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const members = FORBIDDEN_MEMBERS.get(node.expression.text);
      if (members?.has(node.name.text) === true) {
        report(node, `${node.expression.text}.${node.name.text}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return { violations, localImports };
}

/**
 * Every non-CSPRNG source of randomness reachable from the given files.
 *
 * @param paths - Absolute paths to `.ts` files, or directories to walk. Each file's
 *   own relative imports are followed transitively, so handing this the generator is
 *   enough to cover the adapter behind it.
 * @returns An empty array when everything reachable draws its randomness from
 *   `node:crypto`. A non-empty result names the file, the line, and what was flagged,
 *   because "something is not random enough" is not an actionable failure message.
 */
export function findNonCsprngRandomSources(
  paths: readonly string[],
): readonly NonCsprngRandomSource[] {
  const violations: NonCsprngRandomSource[] = [];
  const scanned = new Set<string>();
  const queue = paths.flatMap((path) => sourceFilesUnder(resolve(path)));

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || scanned.has(file)) {
      continue;
    }
    scanned.add(file);

    const result = scanSource(file, readFileSync(file, 'utf8'));
    violations.push(...result.violations);
    queue.push(...result.localImports);
  }

  return violations;
}
