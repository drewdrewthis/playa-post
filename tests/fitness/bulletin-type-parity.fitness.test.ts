import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BULLETIN_TYPE } from '@playa-post/contracts';

import { BOARD_BULLETIN_TYPES } from '../../apps/server/src/modules/views/domain/board-query-grammar';

/**
 * The postable/filterable split behind #87, held together (decision D5).
 *
 * `BULLETIN_TYPE` (six postable types) and `BOARD_BULLETIN_TYPES` (the grammar's
 * `type:` vocabulary, seven with `update`) are deliberately two lists in two modules
 * that must not import each other. Every chip the board renders compiles to
 * `type:<value>`, and the server *refuses* an unknown token by name rather than
 * ignoring it (ADR-0007) — so the subset relation is load-bearing: drop a value from
 * the grammar and its chip becomes a production `INVALID_BOARD_QUERY`, with every
 * suite green. Like `contracts-api-parity`, this file may legally import both sides
 * because `tests/` is outside the cruised roots.
 *
 * The CSS half guards the tint pipeline the same way `board-query.ts`'s
 * `Record<BulletinType, string>` guards chip labels: a new postable type must bring a
 * light tint token, a dark tint token, and a `[data-type]` rule in *both* the card's
 * stylesheet and the detail sheet's — the pair of files whose divergence shipped
 * five request-red detail sheets in the first draft of #87.
 */
describe('bulletin type parity (#87)', () => {
  const postableTypes = Object.values(BULLETIN_TYPE);

  it('keeps every postable type filterable: BULLETIN_TYPE ⊆ BOARD_BULLETIN_TYPES', () => {
    expect(BOARD_BULLETIN_TYPES).toEqual(expect.arrayContaining(postableTypes));
  });

  const webFile = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(`../../apps/web/src/app/${relative}`, import.meta.url)), 'utf8');

  it('gives every postable type a tint token in the light palette and the dark palette', () => {
    const tokens = webFile('theme/tokens.css');
    for (const type of postableTypes) {
      const declarations = tokens.match(new RegExp(`--pp-tint-${type}:`, 'gu')) ?? [];
      expect(declarations, `--pp-tint-${type} must be declared exactly twice (light + dark)`).toHaveLength(2);
    }
  });

  it.each([
    ['theme/screens.css', '.bulletin-card'],
    ['bulletins/detail-sheet.css', '.detail-sheet'],
  ])('routes every postable type to its tint in %s', (stylesheet, selector) => {
    const css = webFile(stylesheet);
    for (const type of postableTypes) {
      expect(css, `${selector}[data-type='${type}'] must map to var(--pp-tint-${type})`).toContain(
        `${selector}[data-type='${type}']`,
      );
    }
  });
});
