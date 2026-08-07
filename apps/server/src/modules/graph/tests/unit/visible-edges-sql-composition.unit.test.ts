import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `modules/graph/persistence/sql/visible-edges.sql` — the composition and containment
 * rules, stated as properties of the checked-in text.
 *
 * The one that matters is the **double join**: an edge is emitted only when *both* of
 * its endpoints are in `app.visible_people(viewer_id)`. Joining the authorized set once
 * would emit edges from a visible person to somebody the viewer cannot see, which turns
 * a cluster view into a way to enumerate strangers — the people search PDF §3/§4
 * forbids. Behaviour is proven against a real database in
 * `graph-edges.integration.test.ts`; a text assertion is what catches a join being
 * deleted "because the query is slow", which the behavioural suite would only catch if
 * somebody had thought to seed a second-degree stranger.
 *
 * No database needed: these are properties of the checked-in SQL, not of the installed
 * catalog object (that is `visible-edges-migration.integration.test.ts`'s job).
 */
describe('modules/graph/persistence/sql/visible-edges.sql — composition', () => {
  const sqlPath = fileURLToPath(new URL('../../persistence/sql/visible-edges.sql', import.meta.url));

  function statementText(): string {
    // Strip `--` line comments first: this file's own comments name the rules it is
    // asserting, and would otherwise satisfy every match by describing it.
    return readFileSync(sqlPath, 'utf8')
      .split('\n')
      .map((line) => {
        const commentStart = line.indexOf('--');
        return commentStart === -1 ? line : line.slice(0, commentStart);
      })
      .join('\n');
  }

  it('calls app.visible_people(...) as a subquery rather than re-deriving reachability', () => {
    expect(statementText()).toMatch(/\bapp\.visible_people\s*\(/i);
  });

  it('joins the authorized set TWICE, once per endpoint', () => {
    const joins = statementText().match(/join\s+authorized_people\b/gi) ?? [];

    expect(
      joins,
      'both endpoints must be constrained, or an edge can name somebody the viewer cannot see',
    ).toHaveLength(2);
  });

  it('constrains a different connection column on each join', () => {
    const text = statementText();

    expect(text).toMatch(/user_id\s*=\s*c\.user_a_id/i);
    expect(text).toMatch(/user_id\s*=\s*c\.user_b_id/i);
  });

  it('emits only accepted connections', () => {
    expect(statementText()).toMatch(/c\.status\s*=\s*'accepted'/i);
  });

  it('carries no trust or weight column (ADR-0004 decision 6, ADR-0002 B6)', () => {
    const text = statementText();

    expect(text).not.toMatch(/\btrust\b/i);
    expect(text).not.toMatch(/\bweight\b/i);
    expect(text).not.toMatch(/app\.connection_trust\b/i);
  });

  it('never projects an identity column — an edge is two ids and nothing else', () => {
    const text = statementText();

    expect(text).not.toMatch(/\bdisplay_name\b/i);
    expect(text).not.toMatch(/\bhandle\b/i);
    expect(text).not.toMatch(/\bdisclosure\b/i);
  });

  it('canonicalises the pair, so one undirected connection is one edge', () => {
    const text = statementText();

    expect(text).toMatch(/least\s*\(\s*c\.user_a_id\s*,\s*c\.user_b_id\s*\)/i);
    expect(text).toMatch(/greatest\s*\(\s*c\.user_a_id\s*,\s*c\.user_b_id\s*\)/i);
  });
});
