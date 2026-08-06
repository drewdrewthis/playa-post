import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * The `sql-table-ownership` walker — m2-lane-briefs.md:311, blocking finding B-3.
 *
 * `dependency-cruiser` and `no-sql-outside-persistence` both see *code*: import
 * edges and TypeScript SQL literals. A checked-in `.sql` file is opaque to both —
 * `modules/bulletins/persistence/sql/board.sql` could join `app.connections`
 * directly, re-deriving reachability instead of composing L2's `app.visible_people`
 * CTE, and every existing gate stays green (m2-lane-briefs.md:313-319, R2, the
 * plan's only Critical-severity risk). This rule closes that gap: it parses each
 * checked-in `.sql` file under a module's `persistence/sql/` directory and flags any
 * `app.<table>` reference that is not in that module's own table set, not a
 * sanctioned `app.visible_*` function call, and not explicitly allowlisted for that
 * module.
 *
 * **Scope: `modules/<m>/persistence/sql/**\/*.sql` only** — hand-authored,
 * checked-in SQL. Migration SQL under `supabase/migrations/` is out of scope; it
 * defines the tables, it does not consume them through an authorized-set query.
 *
 * **Allowlist, not a hardcoded per-module table list.** L2 owns two modules
 * (`connections`, `graph`) that must cooperate at the SQL layer: `app.visible_people`
 * is *the* canonical "who can this viewer reach" function (ADR-0004:75-77, C8), and
 * it necessarily reads `app.connections` and `app.connection_trust` — tables
 * `modules/connections` owns — plus `app.users` for the identity data only this one
 * function is allowed to join directly (§6a: "no direct join to `app.users` for an
 * author card, ever" is a rule for *consumers* of `visible_people`, not for the
 * function itself). `sql-table-ownership-allowlist.json` records this per module
 * rather than baking it into this file, so a reviewer can see and approve the
 * cross-module grant. **This file does not decide that grant** — it is an AC
 * ambiguity recorded in the L2 test-writing report; the coder/reviewer owns ratifying
 * (or narrowing) the allowlist in the same PR that adds `visible-people.sql`.
 *
 * A referenced identifier is treated as a *function call* (exempt, so long as its
 * name starts `visible_`) when immediately followed by `(`; otherwise it is a table
 * reference and must be owned or allowlisted.
 */

export interface SqlTableOwnershipViolation {
  /** Absolute path of the offending `.sql` file. */
  readonly file: string;
  /** 1-based line of the reference. */
  readonly line: number;
  /** The unauthorized `app.<table>` identifier. */
  readonly reference: string;
}

const SQL_TABLE_REFERENCE = /\bapp\.([a-zA-Z_][a-zA-Z0-9_]*)\b(\s*\()?/g;

/**
 * @param sqlFiles absolute paths to `.sql` files, or directories to walk recursively
 *   for `.sql` files.
 * @param allowlist per-module extra `app.<table>` names permitted beyond the
 *   module's own tables (module name is the path segment under `modules/`).
 * @param ownTables per-module tables the module owns outright (its own persistence
 *   tables), always permitted.
 */
export function findSqlTableOwnershipViolations(
  sqlFiles: readonly string[],
  options: {
    readonly allowlist?: Readonly<Record<string, readonly string[]>>;
    readonly ownTables?: Readonly<Record<string, readonly string[]>>;
  } = {},
): readonly SqlTableOwnershipViolation[] {
  const allowlist = options.allowlist ?? {};
  const ownTables = options.ownTables ?? {};
  const violations: SqlTableOwnershipViolation[] = [];

  for (const path of sqlFiles) {
    for (const file of collectSqlFiles(path)) {
      const moduleName = moduleNameOf(file);
      const permitted = new Set([
        ...(moduleName !== undefined ? (ownTables[moduleName] ?? []) : []),
        ...(moduleName !== undefined ? (allowlist[moduleName] ?? []) : []),
      ]);

      const contents = readFileSync(file, 'utf8');
      const lines = contents.split('\n');
      lines.forEach((rawLineText, index) => {
        // Strip a `--` line comment before matching: a reference mentioned in prose
        // (this rule's own fixtures document themselves that way) is not a SQL
        // reference. Only `--` is stripped, not `/* */`, matching this codebase's
        // checked-in SQL style (see visible-people.sql's own comments).
        const commentStart = rawLineText.indexOf('--');
        const lineText = commentStart === -1 ? rawLineText : rawLineText.slice(0, commentStart);
        for (const match of lineText.matchAll(SQL_TABLE_REFERENCE)) {
          const [, table, isCall] = match;
          if (table === undefined) {
            continue;
          }
          if (isCall !== undefined && table.startsWith('visible_')) {
            continue; // sanctioned app.visible_* function call
          }
          if (permitted.has(table)) {
            continue;
          }
          violations.push({ file, line: index + 1, reference: `app.${table}` });
        }
      });
    }
  }

  return violations;
}

function collectSqlFiles(path: string): readonly string[] {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    return path.endsWith('.sql') ? [path] : [];
  }

  const results: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSqlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      results.push(entryPath);
    }
  }
  return results;
}

/** Extracts the module name from a `.../modules/<name>/persistence/sql/...` path. */
function moduleNameOf(file: string): string | undefined {
  const segments = file.split(sep);
  const modulesIndex = segments.indexOf('modules');
  if (modulesIndex === -1 || modulesIndex + 1 >= segments.length) {
    return undefined;
  }
  return segments[modulesIndex + 1];
}
