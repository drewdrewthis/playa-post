import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import ts from 'typescript';

/**
 * The `no-sql-outside-persistence` walker — M1b.9's second half.
 *
 * `dependency-cruiser` polices import *edges*, and this rule is about string and
 * tagged-template *contents*, so it cannot live in `.dependency-cruiser.cjs` (that
 * file's own header says so). It is also not a grep: `sql` fragments and query strings
 * are syntax, and a text search cannot tell a SQL statement in a doc comment — which
 * is fine — from one in an argument, which is not. This parses.
 *
 * **Scope: `apps/server/src/**`, minus `persistence/`, minus tests.** The rule is
 * architecture-addendum §19's layering, and §19 is about the server's layered tree.
 * `packages/**` is deliberately out of scope: those are libraries rather than layered
 * modules, and two of them run SQL by design — `packages/database` owns the connection
 * and `packages/testing` truncates tables between integration tests. Widening this to
 * "any SQL literal anywhere" would fail both on day one, and a rule that needs
 * exceptions on day one is a rule nobody keeps.
 *
 * The two fixtures under `tests/fitness/sql-fixtures/` mirror the real path shape
 * (`…/apps/server/src/modules/identity/…`), which is why scoping is decided on the
 * path *after* `apps/server/src/` rather than on the absolute path — the violating
 * fixture lives under a directory called `tests/`, and judging the whole path would
 * skip the one file this rule must catch.
 */

/** One SQL literal in a file that has no business holding one. */
export interface SqlLiteralViolation {
  /** Absolute path of the offending file. */
  readonly file: string;
  /** 1-based line of the literal. */
  readonly line: number;
  /** Why it was flagged — a `sql` tag, or the statement the literal starts with. */
  readonly reason: string;
  /** The first line of the literal, trimmed, so the failure names the SQL. */
  readonly excerpt: string;
}

/** The layered tree this rule governs. */
const SERVER_SOURCE_MARKER = 'apps/server/src/';

/** The layer SQL belongs to, and the only one exempt. */
const PERSISTENCE_DIRECTORY = 'persistence';

/** Directories whose contents are test material, not layered production code. */
const TEST_DIRECTORIES = new Set(['tests', '__tests__', '__fixtures__']);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * Tag names that declare their template to be SQL.
 *
 * A tagged template is flagged on the **tag alone**, whatever it contains: `sql` says
 * "this is SQL" more reliably than any heuristic could infer it, and
 * `@playa-post/database` re-exports Kysely's `sql` under its own name — so the import
 * specifier reads `@playa-post/database` and no import-edge rule can see it. This is
 * the check that closes that door.
 */
const SQL_TAG_NAMES = new Set(['sql']);

/** Optional leading whitespace and `--` comment lines, so a commented statement still counts. */
const STATEMENT_PREFIX = String.raw`^\s*(?:--[^\n]*\n\s*)*`;

/** The object kinds each DDL verb can govern — the tokens that make it SQL rather than English. */
const OBJECT_KINDS =
  'table|index|view|materialized|schema|function|procedure|sequence|policy|role|type|trigger|domain|extension|database|publication|unique';

/** Privileges a GRANT or REVOKE names before its `ON`. */
const PRIVILEGES =
  'all|select|insert|update|delete|truncate|references|trigger|usage|execute|create|connect|temporary|temp|maintain';

/**
 * Literals that open with a SQL statement, one pattern per verb.
 *
 * **Each verb requires a SQL-specific follower, and that is the whole design.** A bare
 * `/^(update|create|drop)\b/` also matches `'Update your handle in settings.'`, and a
 * rule that fails CI on a user-facing sentence is a rule that gets an exception list
 * and then gets deleted. Requiring `update … set`, `create table`, `delete from` costs
 * nothing in coverage — real statements always carry them — and buys the rule the
 * right to be trusted.
 *
 * Transaction verbs (`begin`, `commit`, `rollback`) are deliberately absent: they are
 * the most prose-like words of the set, and this codebase runs transactions through
 * the query builder's API, never as literals.
 */
const SQL_STATEMENT_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  // `[\w"*(]` before `.*?from` is what stops "Select from the list" matching: something
  // has to stand where the column list goes, and it cannot be the `from` itself.
  { name: 'select … from', pattern: new RegExp(`${STATEMENT_PREFIX}select\\s+(?:distinct\\s+)?[\\w"*(].*?\\bfrom\\b`, 'is') },
  { name: 'insert into', pattern: new RegExp(`${STATEMENT_PREFIX}insert\\s+into\\s+\\S`, 'i') },
  { name: 'update … set', pattern: new RegExp(`${STATEMENT_PREFIX}update\\s+[\\w".]+\\s+set\\b`, 'is') },
  { name: 'delete from', pattern: new RegExp(`${STATEMENT_PREFIX}delete\\s+from\\s+\\S`, 'i') },
  { name: 'create', pattern: new RegExp(`${STATEMENT_PREFIX}create\\s+(?:or\\s+replace\\s+)?(?:${OBJECT_KINDS})\\b`, 'i') },
  { name: 'alter', pattern: new RegExp(`${STATEMENT_PREFIX}alter\\s+(?:default\\s+privileges|${OBJECT_KINDS})\\b`, 'i') },
  { name: 'drop', pattern: new RegExp(`${STATEMENT_PREFIX}drop\\s+(?:${OBJECT_KINDS})\\b`, 'i') },
  { name: 'truncate', pattern: new RegExp(`${STATEMENT_PREFIX}truncate\\s+(?:table\\b|["\\w]+\\.["\\w]+)`, 'i') },
  // Privilege words before the `on`, so "Grant access to your connections." is prose
  // and `grant usage on schema app` is not.
  { name: 'grant/revoke', pattern: new RegExp(`${STATEMENT_PREFIX}(?:grant|revoke)\\s+(?:${PRIVILEGES})\\b[\\s\\S]{0,160}?\\bon\\b`, 'i') },
  { name: 'common table expression', pattern: new RegExp(`${STATEMENT_PREFIX}with\\s+[\\w"]+\\s+as\\s*\\(`, 'is') },
  { name: 'comment on', pattern: new RegExp(`${STATEMENT_PREFIX}comment\\s+on\\s+(?:${OBJECT_KINDS}|column)\\b`, 'i') },
  { name: 'set role', pattern: new RegExp(`${STATEMENT_PREFIX}set\\s+role\\s+\\w`, 'i') },
];

/** The name of the first statement shape this literal matches, if any. */
function matchedStatement(text: string): string | undefined {
  return SQL_STATEMENT_PATTERNS.find(({ pattern }) => pattern.test(text))?.name;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

/**
 * The portion of a path this rule judges, or `undefined` when the file is out of scope.
 *
 * @returns the path relative to the nearest `apps/server/src/`, so a fixture that
 *   mirrors the real tree is judged by the shape it mirrors, not by where it is kept.
 */
function serverRelativePath(absolutePath: string): string | undefined {
  const posix = toPosixPath(absolutePath);
  const index = posix.lastIndexOf(SERVER_SOURCE_MARKER);

  return index === -1 ? undefined : posix.slice(index + SERVER_SOURCE_MARKER.length);
}

/** Is this file production code in a layer that must not contain SQL? */
export function isScannedFile(absolutePath: string): boolean {
  if (!SOURCE_EXTENSIONS.some((extension) => absolutePath.endsWith(extension))) {
    return false;
  }

  const relative = serverRelativePath(absolutePath);
  if (relative === undefined) {
    return false;
  }

  const segments = relative.split('/');
  const directories = segments.slice(0, -1);
  const filename = segments.at(-1) ?? '';

  if (directories.includes(PERSISTENCE_DIRECTORY)) {
    return false;
  }
  if (directories.some((directory) => TEST_DIRECTORIES.has(directory))) {
    return false;
  }

  return !/\.(test|spec)\.[cm]?tsx?$/.test(filename) && !filename.endsWith('.d.ts');
}

/** Every file under `root`, at any depth. `root` may itself be a file. */
function filesUnder(root: string): string[] {
  let entry;
  try {
    entry = statSync(root);
  } catch {
    return [];
  }
  if (entry.isFile()) {
    return [root];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((child) => {
    if (child.name === 'node_modules' || child.name === 'dist') {
      return [];
    }
    return child.isDirectory() ? filesUnder(join(root, child.name)) : [join(root, child.name)];
  });
}

/** The literal text of a template, ignoring its `${…}` holes. */
function templateText(node: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ');
}

/** The name a tagged template was tagged with — `sql`, `db.sql`, `sql.raw` → `sql`. */
function tagName(tag: ts.Expression): string | undefined {
  if (ts.isIdentifier(tag)) {
    return tag.text;
  }
  if (ts.isPropertyAccessExpression(tag)) {
    return ts.isIdentifier(tag.expression) ? tag.expression.text : tag.name.text;
  }
  return undefined;
}

function scanSource(absolutePath: string, contents: string): SqlLiteralViolation[] {
  const source = ts.createSourceFile(
    absolutePath,
    contents,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const violations: SqlLiteralViolation[] = [];

  const record = (node: ts.Node, text: string, reason: string): void => {
    violations.push({
      file: absolutePath,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      reason,
      excerpt: (text.trim().split('\n')[0] ?? '').slice(0, 120),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = tagName(node.tag);
      if (tag !== undefined && SQL_TAG_NAMES.has(tag)) {
        record(node, templateText(node.template), `\`${tag}\` tagged template`);
        // Deliberately no recursion into the template: every `${…}` inside a SQL
        // fragment would be reported a second time, and one violation per statement
        // is what makes the failure readable.
        return;
      }
    }

    const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? templateText(node)
        : undefined;

    if (text !== undefined) {
      const statement = matchedStatement(text);
      if (statement !== undefined) {
        record(node, text, `SQL literal — \`${statement}\``);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return violations;
}

/**
 * Every SQL literal outside a `persistence/` directory, under the given roots.
 *
 * @param roots - Directories (or files) to walk. Anything outside
 *   `apps/server/src/**` is skipped, so passing a whole repository is safe.
 * @returns an empty array when clean. A non-empty result names the file, the line, and
 *   the statement — "there is SQL somewhere" is not an actionable failure.
 */
export function findSqlLiteralsOutsidePersistence(
  roots: readonly string[],
): readonly SqlLiteralViolation[] {
  return roots
    .flatMap((root) => filesUnder(root))
    .filter(isScannedFile)
    .flatMap((file) => scanSource(file, readFileSync(file, 'utf8')));
}
