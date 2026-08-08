import { expect, test, type Page } from '@playwright/test';

import { BULLETIN_TYPE } from '@playa-post/contracts';

import { matchCountLabel } from '../../apps/web/src/app/bulletins/board-query';
import { bellLabel, matchNowLabel } from '../../apps/web/src/app/views/saved-view-list';

/**
 * The Saved screen, rendered in **both themes**, against the real app (issue #45).
 *
 * ⚠ **This suite exists because the Saved screen stopped being a placeholder in this
 * branch and nothing had photographed it.** `playwright.config.ts` pins
 * `colorScheme: 'light'` for the vertical slice, so a screen's dark rendering is only
 * ever a claim about `tokens.css` until something resolves it in a browser. Every colour
 * on this card comes from a `--pp-*` token and both token sets are declared, but
 * *declared* and *resolves* are different facts and only one of them is visible in a
 * stylesheet.
 *
 * The three states it covers are the three a person actually meets: nothing saved yet,
 * views saved with the bell dark, and the bell lit on exactly one of them — which is
 * decision D1's whole shape (`◉ NOTIFY ON` on one card while every other card still
 * reads `○ NOTIFY OFF`), and the one thing on this screen a still image can prove that
 * an integration test cannot.
 *
 * It writes `docs/engineering/screenshots/m2-saved-views-*.png` when
 * `E2E_SAVED_VIEWS_SCREENSHOT_DIR` is set — the same opt-in shape
 * `report-abuse-sheet.spec.ts` uses, so a normal run writes nothing and asserts
 * everything.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

/**
 * The comp's phone column, at the size the comp is drawn for
 * (`design/Playa Post.dc.html:123` — `position:absolute;inset:0` inside `.app-column`).
 *
 * Scoped here rather than in `playwright.config.ts` so the vertical slice keeps the
 * viewport it was written against.
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/** Both token sets, in the order the screenshots are named. */
const THEMES = ['light', 'dark'] as const;

/**
 * The two bulletins User A writes before saving anything.
 *
 * ⚠ **Two, and only one of them mentioning "propane", is a harness requirement rather
 * than set dressing** — see {@link saveViewFromBoard} for the race it closes. Both are
 * `request`s because that is the only type M2 can write.
 *
 * ⚠ **This text must not collide with any bulletin another `tests/e2e/*.spec.ts` file
 * writes.** `global-setup.ts` boots one Testcontainers Postgres for the whole
 * `pnpm test:e2e` run and nothing under `tests/e2e/` truncates it; `playwright.config.ts`
 * runs spec files alphabetically, single-worker, so every bulletin an earlier file
 * composed as User A is still on the board when this file runs. A repeated title
 * double-matches `getByText` below, and a repeated word inside {@link MATCHING_QUERY} or
 * {@link EMPTY_QUERY} double-matches the full-text search those queries compile to
 * (`board-filter.ts`'s `plainto_tsquery('simple', …)`) — both broke this suite (PR #69)
 * before this text was chosen to be unlike anything `report-abuse-sheet.spec.ts` or
 * `vertical-slice-e2e.spec.ts` writes.
 */
const BULLETINS = [
  {
    title: 'Borrowing a propane wrench this afternoon',
    body: 'Stove regulator is stuck, back by sundown.',
  },
  {
    title: 'Extra solar charging capacity to share',
    body: 'Charging more than our rig uses, come plug in.',
  },
] as const;

/**
 * The query saved as the first view, and the number of {@link BULLETINS} it matches.
 *
 * It matches one of the two, so the card's "N match now" line carries a real number
 * rather than the zero every query would produce on an empty board — the count is
 * `bulletins.board` run per view, and a screenshot of it reading `0 match now` would not
 * distinguish "the count works" from "the count is stuck".
 */
const MATCHING_QUERY = { text: 'type:request propane', matches: 1 } as const;

/**
 * The query saved as the second view, chosen to match neither bulletin.
 *
 * Two cards with different counts is what makes the count provably per-view rather than
 * one number rendered twice.
 */
const EMPTY_QUERY = { text: 'type:request bicycle', matches: 0 } as const;

/** See `vertical-slice-e2e.spec.ts`'s `bootstrapSession` for why this key and this shape. */
async function bootstrapSession(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript((token: string) => {
    (
      globalThis as { localStorage: { setItem(key: string, value: string): void } }
    ).localStorage.setItem('playa-post:e2e-session', JSON.stringify({ accessToken: token }));
  }, accessToken);
  await page.goto('/');
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }

  return value;
}

/**
 * Writes one PNG, or nothing when the suite is not being run for its pictures.
 *
 * ⚠ **`animations: 'disabled'` is load-bearing, not tidiness.** Playwright's default is
 * `'allow'`, which photographs whatever frame the shutter lands on — a screen that enters
 * on an opacity transition comes out half-transparent with the layer beneath bleeding
 * through, which looks exactly like a rendering defect and is really a picture of the
 * harness. `report-abuse-sheet.spec.ts` shipped four such images before this was
 * understood. This finishes every animation and holds it at its end state.
 *
 * A viewport shot rather than `fullPage`: the screen is `position: absolute` inside the
 * clipped `.app-column`, so the page has no scroll height to extend into and `fullPage`
 * would produce the same pixels under a name implying otherwise.
 */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SAVED_VIEWS_SCREENSHOT_DIR'];

  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
}

/**
 * Seeds the persisted theme the way a returning user carries one.
 *
 * `index.html`'s render-blocking script reads `playapost-theme` before the first paint —
 * this is that mechanism, not a harness back door.
 */
async function seedTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value: string) => {
    (
      globalThis as { localStorage: { setItem(key: string, value: string): void } }
    ).localStorage.setItem('playapost-theme', value);
  }, theme);
}

/**
 * Saves one view through the board's own control, which is the only way a view is made.
 *
 * ⚠ **The wait on `toBeEnabled()` is an assertion about the control, not a sleep.** The
 * save button appears on the first keystroke — `BoardSearch` shows it off the **raw**
 * field — but what gets saved is composed from `useDebounced(search, 250)`, so for a beat
 * there is a query being typed and none that could be saved. The button is `disabled`
 * across exactly that window (`settledQueryActive`), which is what makes waiting for it
 * to be enabled both a correct wait *and* a standing check that the window is still
 * closed. If the guard were removed the button would be enabled immediately, this helper
 * would click into the dead window, and the notice assertion below would fail.
 *
 * The exact match count is the second guard, and independent of the first: `matchCount` is
 * `board.isSuccess ? visible.length : null` and the board runs with `{}` while the debounce
 * is outstanding, so a loose `/\d+ match(es)?/` would be satisfied by the *unfiltered*
 * answer. Asserting the number this query alone produces can only pass once the debounced
 * query has been composed and answered.
 */
async function saveViewFromBoard(
  page: Page,
  query: { readonly text: string; readonly matches: number },
): Promise<void> {
  await page.goto('/board');
  await page.getByTestId('board-search-input').fill(query.text);
  await expect(page.getByTestId('board-search-match-count')).toHaveText(
    matchCountLabel(query.matches),
  );

  // The control refuses the tap until the query it would save exists.
  await expect(page.getByTestId('board-search-save-button')).toBeEnabled();
  await page.getByTestId('board-search-save-button').click();
  await expect(page.getByTestId('board-save-view-notice')).toHaveText(
    'View saved — find it under Saved',
  );
}

/** Writes one bulletin of the acting user's own, through the compose screen. */
async function composeBulletin(
  page: Page,
  bulletin: { readonly title: string; readonly body: string },
): Promise<void> {
  await page.getByTestId('compose-bulletin-button').click();
  // `BULLETIN_TYPE.request` rather than a literal: it is the only type M2 can write
  // (`bulletins/domain/bulletin.ts` — the other six are M5), so a hard-coded 'offer'
  // waits out the full timeout on an option the product does not offer.
  await page.getByTestId('compose-bulletin-type-select').selectOption(BULLETIN_TYPE.request);
  await page.getByTestId('compose-bulletin-title-input').fill(bulletin.title);
  await page.getByTestId('compose-bulletin-body-input').fill(bulletin.body);
  await page.getByTestId('compose-bulletin-submit-button').click();
  // By its title rather than by a card test id: the id carries a server-issued UUID this
  // helper never sees, and the title is what proves *this* bulletin landed rather than
  // that some card is on screen.
  await expect(page.getByText(bulletin.title)).toBeVisible();
}

/** Opens `/saved` under `theme` and waits for the screen to have settled. */
async function openSavedScreen(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await seedTheme(page, theme);
  await page.goto('/saved');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByTestId('saved-views')).toBeVisible();
  // The screen renders an error paragraph instead of the list when `views.saved.list`
  // refuses. Asserting its absence is what stops a 401 — the shape the unset
  // `VITE_SUPABASE_URL` trap produces — being photographed as a design.
  await expect(page.getByTestId('saved-views-error')).toHaveCount(0);
}

test.describe('the Saved screen renders in both themes', () => {
  test('shows the empty state, the saved cards, and the bell lit on exactly one', async ({
    page,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');

    await bootstrapSession(page, userAAccessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();

    /*
     * Two bulletins of User A's own, so the saved views have something real to count. A
     * brand-new user with no connections still sees what they wrote themselves, which is
     * why this needs none of the invite/accept setup the two-user suites carry.
     */
    for (const bulletin of BULLETINS) {
      await composeBulletin(page, bulletin);
    }

    /* 1. Nothing saved yet — the state every person meets first. */
    for (const theme of THEMES) {
      await openSavedScreen(page, theme);

      await expect(page.getByTestId('saved-view')).toHaveCount(0);
      await expect(page.getByText('Nothing saved yet. Search the board and save what you find.')).toBeVisible();
      // The lede and the aside are the comp's own copy (`design/Playa Post.dc.html:124`
      // and `:139`) and both are on screen in the empty state, so the screenshot is of a
      // finished screen rather than a blank one.
      await expect(
        page.getByText('Saved views run over what you can already see — never more.'),
      ).toBeVisible();

      await capture(page, `m2-saved-views-empty-${theme}`);
    }

    await saveViewFromBoard(page, MATCHING_QUERY);
    await saveViewFromBoard(page, EMPTY_QUERY);

    /* 2. Two views, both bells dark. */
    for (const theme of THEMES) {
      await openSavedScreen(page, theme);

      const cards = page.getByTestId('saved-view');
      await expect(cards).toHaveCount(2);
      // Oldest first, which is the order the repository guarantees so a card does not
      // move under a thumb between renders.
      await expect(page.getByTestId('saved-view-name')).toHaveText([
        MATCHING_QUERY.text,
        EMPTY_QUERY.text,
      ]);

      // Both bells off, as words rather than as pixels: `bellLabel` is the comp's own
      // `v.bellLabel` (`design/Playa Post.dc.html:783`), so this asserts the glyph too.
      await expect(page.getByTestId('saved-view-bell')).toHaveText([
        bellLabel(false),
        bellLabel(false),
      ]);
      for (const index of [0, 1]) {
        await expect(page.getByTestId('saved-view-bell').nth(index)).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      }

      // ⚠ The counts are the reason a bulletin was composed above. Different numbers on
      // the two cards is what proves "N match now" is `bulletins.board` run per view
      // rather than one number rendered twice — and asserting them at all is what stops a
      // screenshot of a screen whose count line silently rendered nothing.
      await expect(page.getByTestId('saved-view-count')).toHaveText([
        matchNowLabel(MATCHING_QUERY.matches) ?? '',
        matchNowLabel(EMPTY_QUERY.matches) ?? '',
      ]);

      await capture(page, `m2-saved-views-list-${theme}`);
    }

    /* 3. The bell lit on exactly one card — decision D1, as a picture. */
    await openSavedScreen(page, 'light');
    await page.getByTestId('saved-view-bell').first().click();
    await expect(page.getByTestId('saved-views-status')).toHaveText(
      'You’ll hear when new bulletins match',
    );

    for (const theme of THEMES) {
      await openSavedScreen(page, theme);

      // One lit, one dark, in one frame. Both states of the control are therefore in
      // every screenshot this loop writes, which is what the design review needs to see
      // and what a per-card boolean would have made impossible to guarantee.
      await expect(page.getByTestId('saved-view-bell')).toHaveText([
        bellLabel(true),
        bellLabel(false),
      ]);
      await expect(page.getByTestId('saved-view-bell').first()).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByTestId('saved-view-bell').nth(1)).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      await capture(page, `m2-saved-views-notify-on-${theme}`);
    }
  });
});
