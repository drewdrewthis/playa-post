import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { B_ROW_IDS, loadBRowManifest, REPOSITORY_ROOT, type BRow } from './b-rows';

/**
 * The B-row gate (implementation-plan M1-AC8).
 *
 * ADR-0002 gives up database-enforced viewer visibility, which makes `tests/security/`
 * the control rather than a test suite. The failure this file exists to prevent is the
 * quiet one: a row disappearing from the manifest, or a row claiming `live` while
 * nothing executes it. Both leave the suite green and the control absent.
 *
 * Every row gets its own `it`, so a run prints all eighteen IDs and their state — the
 * evidence M1-AC8 asks for is the runner output itself, not a separate report.
 */
describe('ADR-0002 B-row manifest', () => {
  const manifest = loadBRowManifest();
  const byId = new Map<string, BRow>(manifest.map((row) => [row.id, row]));

  it('declares exactly B1-B18, once each', () => {
    expect(manifest.map((row) => row.id)).toEqual([...B_ROW_IDS]);
  });

  describe.each(B_ROW_IDS)('%s', (id) => {
    const row = byId.get(id);

    it('is declared, with a state', () => {
      expect(row, `${id} is missing from b-rows.manifest.json`).toBeDefined();
      expect(row?.status).toMatch(/^(live|pending)$/);
    });

    it('carries what its state requires', () => {
      if (row === undefined) {
        // Reported by the assertion above; nothing further is knowable here.
        return;
      }

      if (row.status === 'pending') {
        // A deferred row names the milestone that unblocks it and what is missing.
        // "A B-row is never deferred silently" — implementation-plan line 71.
        expect(row.pendingUntil, `${id} is pending without a milestone`).toMatch(/^M\d/);
        expect(row.reason.length, `${id} is pending without a reason`).toBeGreaterThan(20);
        return;
      }

      // A `live` row must point at a file that exists and that names the row. This is
      // what stops a row being promoted to `live` by editing JSON: deleting the
      // assertion, or the file, fails here rather than quietly shrinking the control.
      const provenBy = join(REPOSITORY_ROOT, row.provenBy);
      expect(existsSync(provenBy), `${id} claims proof in ${row.provenBy}, which does not exist`).toBe(
        true,
      );
      expect(
        readFileSync(provenBy, 'utf8'),
        `${id} claims proof in ${row.provenBy}, which never mentions ${id}`,
      ).toContain(id);
    });
  });

  it('reports the live/pending split so a shrinking suite is visible in the log', () => {
    const live = manifest.filter((row) => row.status === 'live').map((row) => row.id);
    const pending = manifest.filter((row) => row.status === 'pending').map((row) => row.id);

    // Not a redundant restatement of the per-row checks: this is the one line a human
    // reads to see the control's current size. It is deliberately exact, so promoting a
    // row to `live` is a visible diff here and not just a JSON edit.
    expect({ live, pending: pending.length }).toEqual({
      live: ['B1', 'B3', 'B4'],
      pending: 15,
    });
  });
});
