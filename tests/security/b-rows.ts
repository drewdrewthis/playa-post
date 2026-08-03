import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `tests/security/`, resolved from this file rather than from `process.cwd()` so the
 * suite behaves identically whether Vitest runs from the repo root or an editor.
 */
export const SECURITY_TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/** Repository root, for resolving a row's repo-relative `provenBy` path. */
export const REPOSITORY_ROOT = join(SECURITY_TESTS_DIRECTORY, '..', '..');

/**
 * Every row ID in ADR-0002's bypass-test plan, in order.
 *
 * Hard-coded rather than derived from the manifest on purpose: a manifest that
 * defines its own expected contents cannot detect a deleted row (M1-AC8). This
 * list is the independent expectation the manifest is checked against, so
 * shortening the manifest fails instead of silently narrowing the suite.
 */
export const B_ROW_IDS = [
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'B11',
  'B12',
  'B13',
  'B14',
  'B15',
  'B16',
  'B17',
  'B18',
] as const;

export type BRowId = (typeof B_ROW_IDS)[number];

/** Whether a row's assertion runs today, or is owed to a named milestone. */
export type BRowStatus = 'live' | 'pending';

/** A row whose assertion executes against a real database in this repository. */
export interface LiveBRow {
  readonly id: string;
  readonly title: string;
  readonly assertion: string;
  readonly status: 'live';
  /** Repo-relative path of the test file that executes this row. */
  readonly provenBy: string;
}

/** A row that cannot be asserted yet, with the milestone that unblocks it. */
export interface PendingBRow {
  readonly id: string;
  readonly title: string;
  readonly assertion: string;
  readonly status: 'pending';
  /** Milestone ID from `docs/engineering/implementation-plan.md`. */
  readonly pendingUntil: string;
  /** What is missing. Deferral is never silent (plan line 71). */
  readonly reason: string;
}

export type BRow = LiveBRow | PendingBRow;

/**
 * Read and validate `b-rows.manifest.json`.
 *
 * Validation is structural only — that every declared row is well-formed. Whether
 * the *set* of rows matches {@link B_ROW_IDS}, and whether a `live` row is really
 * proven, is asserted by `b-row-manifest.security.test.ts` so those failures are
 * reported as test results rather than as a thrown loader error.
 *
 * @throws if the file is unreadable, is not an object with a `rows` array, or any
 *   row is missing a required field for its status.
 */
export function loadBRowManifest(): readonly BRow[] {
  const path = join(SECURITY_TESTS_DIRECTORY, 'b-rows.manifest.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isRecord(parsed) || !Array.isArray(parsed['rows'])) {
    throw new Error(`${path}: expected an object with a "rows" array`);
  }

  return parsed['rows'].map((row, index) => parseRow(row, `${path} rows[${index}]`));
}

/**
 * The SECURITY DEFINER functions ADR-0002 B4 permits in schema `app`, as
 * schema-qualified `identity_arguments`-free names (e.g. `app.claim_invite`).
 *
 * @throws if the file is unreadable or is not an object with a `functions` array
 *   of strings.
 */
export function loadSecurityDefinerAllowlist(): readonly string[] {
  const path = join(SECURITY_TESTS_DIRECTORY, 'security-definer-allowlist.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isRecord(parsed) || !Array.isArray(parsed['functions'])) {
    throw new Error(`${path}: expected an object with a "functions" array`);
  }

  return parsed['functions'].map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`${path} functions[${index}]: expected a non-empty string`);
    }
    return entry;
  });
}

function parseRow(row: unknown, where: string): BRow {
  if (!isRecord(row)) {
    throw new Error(`${where}: expected an object`);
  }

  const id = requireString(row, 'id', where);
  const title = requireString(row, 'title', where);
  const assertion = requireString(row, 'assertion', where);
  const status = requireString(row, 'status', where);

  if (status === 'live') {
    return { id, title, assertion, status, provenBy: requireString(row, 'provenBy', where) };
  }

  if (status === 'pending') {
    return {
      id,
      title,
      assertion,
      status,
      pendingUntil: requireString(row, 'pendingUntil', where),
      reason: requireString(row, 'reason', where),
    };
  }

  throw new Error(`${where}: status must be "live" or "pending", got ${JSON.stringify(status)}`);
}

function requireString(row: Record<string, unknown>, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
