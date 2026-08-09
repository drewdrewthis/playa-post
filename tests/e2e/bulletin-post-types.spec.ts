import { expect, test, type Page } from '@playwright/test';

import { BULLETIN_TYPE } from '@playa-post/contracts';

/**
 * The six postable bulletin types, through the real compose form (#87,
 * `specs/features/bulletin-post-types.feature` — the refusal and filter scenarios are
 * API-level in `bulletin-post-types.integration.test.ts`; this spec proves the two
 * things only a browser can: the select offers exactly the postable vocabulary, and a
 * board of mixed types renders each card under its own type badge).
 *
 * Writes `docs/engineering/screenshots/m5-board-post-types.png` when
 * `E2E_TYPES_SCREENSHOT_DIR` is set — the same opt-in shape as
 * `E2E_YOU_SCREENSHOT_DIR` in `you-screen.spec.ts`, so a normal run writes nothing.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set by global-setup before this spec runs`);
  }
  return value;
}

/** Mirrors `vertical-slice-e2e.spec.ts` — see the judgment-call comment there. */
async function bootstrapSession(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript((token: string) => {
    (globalThis as { localStorage: { setItem(key: string, value: string): void } }).localStorage.setItem(
      'playa-post:e2e-session',
      JSON.stringify({ accessToken: token }),
    );
  }, accessToken);
  await page.goto('/');
}

test.describe('Bulletin post types (#87)', () => {
  test('the compose select offers the six postable types and the board badges each', async ({
    page,
  }) => {
    const postableTypes = Object.values(BULLETIN_TYPE);
    await bootstrapSession(page, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
    await expect(page.getByTestId('graph-home')).toBeVisible();

    const composedIds: string[] = [];
    for (const type of postableTypes) {
      await page.goto('/board');
      await page.getByTestId('compose-bulletin-button').click();

      // The select's option values ARE the postable vocabulary — no `update`, no
      // `note` (`board-query.ts` explains why the write surface is narrower than the
      // `type:` grammar). Asserted on every pass so a flaky first render cannot hide
      // a stale option list.
      const select = page.getByTestId('compose-bulletin-type-select');
      await expect(select.locator('option')).toHaveText(
        postableTypes.map((value) => new RegExp(value, 'iu')),
      );

      await select.selectOption(type);
      await page.getByTestId('compose-bulletin-title-input').fill(`A ${type} for the board`);
      await page.getByTestId('compose-bulletin-body-input').fill(`Body of the ${type} bulletin.`);
      await page.getByTestId('compose-bulletin-submit-button').click();

      const createdCard = page.locator('[data-testid^="board-bulletin-card-"]').first();
      await expect(createdCard).toBeVisible();
      await expect(createdCard).toHaveAttribute('data-type', type);
      composedIds.push(
        (await createdCard.getAttribute('data-testid'))?.replace('board-bulletin-card-', '') ?? '',
      );
    }

    // All six cards on one board, each badged as its own type — the tint rules in
    // `screens.css` key off exactly this attribute.
    await page.goto('/board');
    for (const [index, type] of postableTypes.entries()) {
      const card = page.getByTestId(`board-bulletin-card-${composedIds[index] ?? ''}`);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-type', type);
    }

    const directory = process.env['E2E_TYPES_SCREENSHOT_DIR'];
    if (directory !== undefined && directory !== '') {
      await page.screenshot({ path: `${directory}/m5-board-post-types.png`, fullPage: true });
    }
  });
});
