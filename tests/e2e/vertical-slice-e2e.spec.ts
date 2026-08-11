import { expect, test, type Page } from '@playwright/test';

import { mintInviteViaYouScreen } from './support/mint-invite';

/**
 * `specs/features/vertical-slice-e2e.feature` › "The full addendum §23 flow passes as
 * eleven named steps" (M2-AC1). The only browser-driven test in M2
 * (`m2-lane-briefs.md` §"What `@e2e` means in a lane"). Two browser contexts, eleven
 * named `test.step()`s matching the feature table verbatim, real backend
 * (`tests/e2e/global-setup.ts`), real Postgres, real tRPC router. The two mocked
 * boundaries are the ones the lane brief allows: the Supabase Auth JWT issuer
 * (`tests/e2e/support/mock-supabase-jwt-issuer.ts`) and the Web Push delivery
 * endpoint (`tests/e2e/support/mock-web-push-transport.ts`).
 *
 * ---
 *
 * ## data-testid contract — apps/web must implement every one of these
 *
 * Resilient selectors only: `getByTestId` for anything product-specific, `getByRole`
 * for standard form controls with an accessible name. No CSS class or DOM-structure
 * selectors. Every id below is referenced by exactly one step unless noted.
 *
 * | data-testid | Where | What it marks |
 * |---|---|---|
 * | `graph-home` | post-sign-in | Root container of the signed-in graph home view |
 * | `invite-link` | You screen (CONNECT card) | The invite URL, minted on arrival. Since #142/#90 there is no invite control on graph home at all, so this is the only place a token comes from — see `support/mint-invite.ts` |
 * | `invite-open-view` | `/invite/:token` | Preview of who the token invites the viewer to connect with |
 * | `invite-accept-button` | `/invite/:token` | Spend the token and accept the connection |
 * | `connection-accepted-banner` | post-accept | Confirms the connection is now active |
 * | `graph-connection-node-<handle>` | graph home | One connected person's node, clickable to open their person sheet |
 * | `person-sheet-save-trust-button` | person sheet | Persists the trust slider's value |
 * | `graph-connection-edge-<handle>` | graph home | Visible edge/row proving the connection rendered for this viewer |
 * | `compose-bulletin-button` | app shell (the compose FAB) | Opens the compose form. Present on every authenticated screen since the design wave (#51) replaced the per-screen buttons with one FAB in the tab bar |
 * | `compose-bulletin-type-select` | compose form | `<select>` with an accessible name "Type"; values include `request` |
 * | `compose-bulletin-title-input` | compose form | Title field |
 * | `compose-bulletin-body-input` | compose form | Body field |
 * | `compose-bulletin-submit-button` | compose form | Posts the bulletin |
 * | `board-bulletin-card-<bulletinId>` | board | One bulletin's card. Carries `data-archived="true"` once archived |
 * | `notifications-bell-button` | app shell | Opens the notifications panel (a full-column takeover since #51, not a dropdown) |
 * | `notification-grouped-item` | notifications panel | One grouped Notify Me notification |
 * | `bulletin-open-button` | inside a `board-bulletin-card-*` | The card's tap target. Opens the detail sheet — since the design wave (#46/#47) the card is a badge, a time, a title and a meta line, and the body and every action live in the sheet |
 * | `bulletin-detail-sheet` | board | The bottom sheet one card's `bulletin-open-button` opens |
 * | `bulletin-dismiss-button` | inside `bulletin-detail-sheet` | Privately dismiss this bulletin for the viewer |
 * | `bulletin-report-button` | inside `bulletin-detail-sheet` | Privately report this bulletin (alternative to dismiss, step 10 accepts either) |
 * | `bulletin-archive-button` | inside `bulletin-detail-sheet`, author only | Archive the bulletin |
 * | `offline-pending-badge` | app shell | Visible while a mutation is queued/pending/inflight per the offline store (ADR-0005:105-107); hidden once synced |
 * | `board-note-card-<noteId>` | board | One note's card, interleaved into the board by time (#88) |
 * | `note-open-button` | inside a `board-note-card-*` | The note card's tap target. A note became a tap target with #176/decision D14 — before that it opened nothing |
 * | `note-detail-sheet` | board | The expanded view one card's `note-open-button` opens (#176) |
 * | `note-detail-pin-back-link` | inside `note-detail-sheet` | Answer the note — routes to the composer with its author preselected. Absent when the author has left the viewer's world, or is further away than one hop |
 * | `person-sheet-pin-note-link` | person sheet | The composer's other entrance, used here only to put a note on a board to open |
 * | `compose-note` | `/board/new?noteTo=…` | The note composer, which is where both pin entrances land |
 * | `compose-note-body-input` · `compose-note-submit-button` · `compose-note-toast` | compose-note | Write it, pin it, and the confirmation that it landed |
 *
 * `getByRole('slider', { name: 'Trust' })` — the person sheet's trust control, not a
 * `data-testid`: a slider's accessible name is exactly what a resilient selector
 * should key on.
 *
 * Sign-in has **no** data-testid in this table on purpose — see `bootstrapSession`
 * below for why, and for the one contract item it *does* impose on the frontend.
 */

/**
 * The real magic-link email flow cannot run in a headless browser — there is no
 * mailbox to read, and only the Supabase Auth **JWT issuer** is on the allowed-mock
 * list (`m2-lane-briefs.md` §"TDD hand-off shape"), not the delivery channel.
 * `global-setup.ts` mints an already-valid access token against that mocked issuer for
 * an already-onboarded `app.users` row (via the real `identity.completeOnboarding`
 * procedure); this seeds it into the page exactly where a real session would land.
 *
 * **Judgment call, recorded for the coder/reviewer to ratify or replace in the same
 * PR that builds sign-in** (mirrors the recorded-assumption convention in
 * `apps/server/src/modules/bulletins/tests/integration/bulletin-request-lifecycle.
 * integration.test.ts`): this assumes the frontend's session bootstrap reads
 * `localStorage['playa-post:e2e-session']` — `{ accessToken: string }` — ahead of its
 * normal Supabase session check, gated to non-production builds. If the coder's
 * real session-storage shape differs, change this function and this comment, not the
 * feature file or the eleven step names.
 */
async function bootstrapSession(page: Page, accessToken: string): Promise<void> {
  // `globalThis` typed `any` rather than `window`: this repo's root tsconfig has no
  // DOM lib (it is a Node-only config — `tsconfig.base.json`'s `lib` is `["ES2022"]`),
  // and this callback's body never runs under that config anyway — Playwright
  // serializes it to run inside the browser page, not in the Node process that
  // type-checks it.
  await page.addInitScript((token: string) => {
    (globalThis as { localStorage: { setItem(key: string, value: string): void } }).localStorage.setItem(
      'playa-post:e2e-session',
      JSON.stringify({ accessToken: token }),
    );
  }, accessToken);
  await page.goto('/');
}

test.describe('The M2 vertical slice, end to end (vertical-slice-e2e.feature, M2-AC1)', () => {
  test('The full addendum §23 flow passes as eleven named steps', async ({ browser }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');
    const userAHandle = requireEnv('E2E_USER_A_HANDLE');
    const userBHandle = requireEnv('E2E_USER_B_HANDLE');

    // Given two browser contexts, one per user.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      let inviteToken = '';
      let bulletinId = '';

      await test.step('1. User A signs in', async () => {
        await bootstrapSession(pageA, userAAccessToken);
        await expect(pageA.getByTestId('graph-home')).toBeVisible();
      });

      // The step name is the feature table's, verbatim, and it names an act rather than a
      // screen — which is why it survives the invite moving to the You screen (#142/#90).
      await test.step('2. User A creates an invite', async () => {
        inviteToken = await mintInviteViaYouScreen(pageA);
      });

      await test.step('3. User B opens the invite', async () => {
        await bootstrapSession(pageB, userBAccessToken);
        await pageB.goto(`/invite/${inviteToken}`);
        await expect(pageB.getByTestId('invite-open-view')).toBeVisible();
      });

      await test.step('4. User B accepts the invite', async () => {
        await pageB.getByTestId('invite-accept-button').click();
        await expect(pageB.getByTestId('connection-accepted-banner')).toBeVisible();
      });

      await test.step('5. User A assigns private directional trust to user B', async () => {
        await pageA.goto('/graph');
        await pageA.getByTestId(`graph-connection-node-${userBHandle}`).click();
        await pageA.getByRole('slider', { name: 'Trust' }).fill('85');
        await pageA.getByTestId('person-sheet-save-trust-button').click();
      });

      await test.step('6. The graph renders the accepted connection for both users', async () => {
        await pageA.goto('/graph');
        await expect(pageA.getByTestId(`graph-connection-edge-${userBHandle}`)).toBeVisible();
        await pageB.goto('/graph');
        await expect(pageB.getByTestId(`graph-connection-edge-${userAHandle}`)).toBeVisible();
      });

      await test.step('7. User A creates a Request bulletin', async () => {
        await pageA.getByTestId('compose-bulletin-button').click();
        await pageA.getByTestId('compose-bulletin-type-select').selectOption('request');
        await pageA.getByTestId('compose-bulletin-title-input').fill('Need a ride to the airport');
        await pageA
          .getByTestId('compose-bulletin-body-input')
          .fill('Leaving Sunday morning, happy to chip in for gas.');
        await pageA.getByTestId('compose-bulletin-submit-button').click();
        const createdCard = pageA.locator('[data-testid^="board-bulletin-card-"]').first();
        await expect(createdCard).toBeVisible();
        bulletinId = (await createdCard.getAttribute('data-testid'))?.replace(
          'board-bulletin-card-',
          '',
        ) ?? '';
        expect(bulletinId).not.toBe('');
      });

      await test.step('8. User B, an eligible viewer, sees the bulletin', async () => {
        await pageB.goto('/board');
        await expect(pageB.getByTestId(`board-bulletin-card-${bulletinId}`)).toBeVisible();
      });

      await test.step('9. Notify Me produces a grouped notification for a matching viewer', async () => {
        await pageB.getByTestId('notifications-bell-button').click();
        // 90s, not the default: the 60-second grouping window (M2-AC7, a domain
        // constant this harness must not shorten) has to fully elapse after step 7's
        // bulletin before the flush may deliver, so the item appears ~60-75s after
        // step 7. 90s covers that plus the harness's 1s flush poll and drainer lag.
        await expect(pageB.getByTestId('notification-grouped-item')).toBeVisible({
          timeout: 90_000,
        });
      });

      await test.step('10. User B dismisses or privately reports the bulletin', async () => {
        // The notifications panel is a full-column takeover since the design wave
        // (#51), not the dropdown it used to be, so the board is genuinely behind it
        // until it is closed — which is what a user has to do too. Closing here rather
        // than reaching around it keeps this step a description of real behaviour.
        await pageB.getByRole('button', { name: 'Close notifications' }).click();

        // Two clicks rather than one since the design wave (#47): the card is a tap
        // target and the moderation actions live in the detail sheet it opens, which is
        // where the comp puts them. Same mutation, same testid, one more step — the
        // step is a description of real behaviour, and this is now the real behaviour.
        const card = pageB.getByTestId(`board-bulletin-card-${bulletinId}`);
        await card.getByTestId('bulletin-open-button').click();
        await pageB
          .getByTestId('bulletin-detail-sheet')
          .getByTestId('bulletin-dismiss-button')
          .click();
        await expect(card).toBeHidden();
      });

      await test.step(
        '11. User A archives the bulletin, and one mutation replays from offline state',
        async () => {
          await pageA.goto('/board');
          await contextA.setOffline(true);
          // The sheet opens offline: its `bulletins.getById` refresh fails with no
          // network, and it falls back to the copy the board was already built from —
          // which is exactly the ADR-0005 behaviour this step exists to prove. The
          // removal action is reachable either way.
          await pageA
            .getByTestId(`board-bulletin-card-${bulletinId}`)
            .getByTestId('bulletin-open-button')
            .click();
          const removeButton = pageA
            .getByTestId('bulletin-detail-sheet')
            .getByTestId('bulletin-archive-button');
          // Same evidence contract as the board capture below: only a local evidence
          // run sets the env var, and it photographs the open sheet with the removal
          // button showing before the click lands.
          const sheetShotPath = process.env['E2E_SHEET_SCREENSHOT_PATH'];
          if (sheetShotPath !== undefined && sheetShotPath !== '') {
            await removeButton.scrollIntoViewIfNeeded();
            await pageA.screenshot({ path: sheetShotPath, animations: 'disabled' });
          }
          await removeButton.click();
          await expect(pageA.getByTestId('offline-pending-badge')).toBeVisible();

          await contextA.setOffline(false);
          await expect(pageA.getByTestId('offline-pending-badge')).toBeHidden();
          await expect(pageA.getByTestId(`board-bulletin-card-${bulletinId}`)).toHaveAttribute(
            'data-archived',
            'true',
          );
        },
      );

      // Not a twelfth step and not an assertion: when the runner asks for it (a local
      // evidence run, never CI), capture the board as User A sees it after the full
      // flow, as the PR's visual proof. Guarded by an env var so a normal run writes
      // nothing into the repo.
      const screenshotPath = process.env['E2E_BOARD_SCREENSHOT_PATH'];
      if (screenshotPath !== undefined && screenshotPath !== '') {
        await pageA.goto('/board');
        await pageA.screenshot({ path: screenshotPath, fullPage: true });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/**
 * The Dismissed category's round trip (#170,
 * `specs/features/moderation-report-dismiss.feature`).
 *
 * Sibling of the eleven-step slice rather than a twelfth step: that test's step names are
 * its feature table's, verbatim, and this is a different feature. It picks up where step
 * 10 stops — a dismissal is where that flow leaves the bulletin, and the thing only a
 * browser can prove is that the category is reachable from the board, holds the bulletin,
 * and gives it back. The server halves are
 * `modules/moderation/tests/integration/dismissed-category.integration.test.ts`.
 *
 * Three data-testids beyond the contract table above, none of them part of it:
 * `board-view-dismissed` and `board-view-board` (the two-view toggle, which writes and
 * clears `?view=`), and `bulletin-undismiss-button` inside `bulletin-detail-sheet` (the
 * category's one action, where a board card offers dismiss and report).
 *
 * Users A and B are already connected by `global-setup.ts`, so this stands on its own
 * rather than on the eleven steps above having run first.
 */
test.describe('The Dismissed category, end to end (moderation-report-dismiss.feature, #170)', () => {
  /** Distinctive enough to find this suite's own card on a board every other spec posts to. */
  const BULLETIN_TITLE = 'Spare goggles at the greeter station';

  test('A dismissed bulletin is browsable under Dismissed, and can be put back', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      let bulletinId = '';

      await test.step('User A posts a bulletin User B can see', async () => {
        await bootstrapSession(pageA, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
        await pageA.goto('/board');
        await pageA.getByTestId('compose-bulletin-button').click();
        await pageA.getByTestId('compose-bulletin-type-select').selectOption('request');
        await pageA.getByTestId('compose-bulletin-title-input').fill(BULLETIN_TITLE);
        await pageA.getByTestId('compose-bulletin-body-input').fill('Two spare pairs, unused.');
        await pageA.getByTestId('compose-bulletin-submit-button').click();

        // By content rather than by list position: this board carries everything every
        // other spec has posted, so `.first()` would lean on a newest-first sort
        // surviving a same-millisecond tie-break.
        const composed = pageA
          .locator('[data-testid^="board-bulletin-card-"]')
          .filter({ hasText: BULLETIN_TITLE });
        await expect(composed).toBeVisible();
        bulletinId = ((await composed.getAttribute('data-testid')) ?? '').replace(
          'board-bulletin-card-',
          '',
        );
        expect(bulletinId).not.toBe('');
      });

      await test.step('User B dismisses it and it leaves their board', async () => {
        await bootstrapSession(pageB, requireEnv('E2E_USER_B_ACCESS_TOKEN'));
        await pageB.goto('/board');
        const card = pageB.getByTestId(`board-bulletin-card-${bulletinId}`);
        await expect(card).toBeVisible();

        await card.getByTestId('bulletin-open-button').click();
        await pageB
          .getByTestId('bulletin-detail-sheet')
          .getByTestId('bulletin-dismiss-button')
          .click();
        await expect(card).toBeHidden();
      });

      await test.step('The Dismissed category holds it', async () => {
        await pageB.getByTestId('board-view-dismissed').click();
        await expect(
          pageB.getByTestId('dismissed-list').getByTestId(`board-bulletin-card-${bulletinId}`),
        ).toBeVisible();
      });

      await test.step('Putting it back empties the category and returns it to the board', async () => {
        await pageB
          .getByTestId('dismissed-list')
          .getByTestId(`board-bulletin-card-${bulletinId}`)
          .getByTestId('bulletin-open-button')
          .click();
        await pageB
          .getByTestId('bulletin-detail-sheet')
          .getByTestId('bulletin-undismiss-button')
          .click();

        // ⚠ Scoped to this bulletin rather than asserting the whole category is empty.
        // Every spec in this suite shares one database and one User B, so anything another
        // spec dismissed is legitimately still here — an emptiness claim would be a claim
        // about them. The locator passes whether the row went or the `<ul>` did.
        await expect(
          pageB.getByTestId('dismissed-list').getByTestId(`board-bulletin-card-${bulletinId}`),
        ).toBeHidden();

        await pageB.getByTestId('board-view-board').click();
        await expect(pageB.getByTestId(`board-bulletin-card-${bulletinId}`)).toBeVisible();
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/**
 * The expanded view of a note, and answering one (#176, decision D14).
 *
 * ⚠ **Last in this file, deliberately, and the reason is cleanup.** `global-setup.ts` boots
 * one database for the whole `pnpm test:e2e` run, nothing truncates it between spec files,
 * and spec files run alphabetically in a single worker — so whatever a file leaves behind
 * belongs to every file that sorts after it. **A pinned note has no take-down at all**:
 * decision D6's corollary gives `app.notes` neither an `archived_at` nor a delete, and D14
 * revisited that and kept it, so the two notes this suite pins genuinely cannot be removed.
 * Only `welcome.spec.ts` and `you-screen.spec.ts` sort after this file and neither reads a
 * board, and within this file the two describes above run first — so the notes land where
 * nothing later looks at them. Moving this describe up, or this file's name down the
 * alphabet, breaks that and nothing will say so.
 *
 * ⚠ **The pin-back control is what this suite exists for, and it is the *only* entrance it
 * proves.** `notification-seen-badge.spec.ts` already walks the person sheet's entrance to
 * the same composer; that walk appears here only to put a note on a board worth opening.
 */
test.describe('Opening a note and answering it (pin-a-note.feature, #176)', () => {
  /** Distinctive enough to find on a board every other spec has posted to. */
  const NOTE_BODY = 'The good coffee is in the blue bin by the shade structure.';
  const REPLY_BODY = 'Found it — leaving you the last of the oat milk.';

  test('A note opens into its expanded view, and can be pinned back from there', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await test.step('User A pins a note to User B’s board', async () => {
        await bootstrapSession(pageA, requireEnv('E2E_USER_A_ACCESS_TOKEN'));

        // Through the graph rather than by building the URL: `pinNoteHref` composes
        // `/board/new?noteTo=<id>` out of an identifier this spec never sees, so walking
        // there is also what proves the recipient the server writes to is the one the
        // reader clicked.
        await pageA.goto('/graph');
        await expect(pageA.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        await pageA.getByTestId(`graph-connection-node-${requireEnv('E2E_USER_B_HANDLE')}`).click();
        await pageA.getByTestId('person-sheet-pin-note-link').click();

        await expect(pageA.getByTestId('compose-note')).toBeVisible();
        await pageA.getByTestId('compose-note-body-input').fill(NOTE_BODY);
        await pageA.getByTestId('compose-note-submit-button').click();
        // The composer's own "it worked", raised only once the queued write has settled —
        // which is what makes this a wait for the delivery rather than for the click.
        await expect(pageA.getByTestId('compose-note-toast')).toBeVisible();
      });

      await test.step('User B taps the note and reads it in full', async () => {
        await bootstrapSession(pageB, requireEnv('E2E_USER_B_ACCESS_TOKEN'));
        await pageB.goto('/board');

        // By content rather than by list position: this board carries everything every
        // other spec has posted, and notes interleave with bulletins by time.
        const card = pageB
          .locator('[data-testid^="board-note-card-"]')
          .filter({ hasText: NOTE_BODY });
        await expect(card).toBeVisible({ timeout: 20_000 });

        await card.getByTestId('note-open-button').click();

        const sheet = pageB.getByTestId('note-detail-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText(NOTE_BODY);
      });

      await test.step('The expanded view offers to pin one back, addressed to its author', async () => {
        // A is B's direct connection, so the control is offered. What decides that is the
        // *degree*, re-read at open time — a card alone is not a reachable person
        // (`note-pin-back.ts`).
        const pinBack = pageB
          .getByTestId('note-detail-sheet')
          .getByTestId('note-detail-pin-back-link');
        await expect(pinBack).toBeVisible();

        await pinBack.click();
        await expect(pageB.getByTestId('compose-note')).toBeVisible();

        await pageB.getByTestId('compose-note-body-input').fill(REPLY_BODY);
        await pageB.getByTestId('compose-note-submit-button').click();
        await expect(pageB.getByTestId('compose-note-toast')).toBeVisible();
      });

      await test.step('The answer lands on User A’s board as a note of its own', async () => {
        // ⚠ The whole point of decision D14, asserted where it is observable: pinning back
        // wrote a **new note**, so it arrives as its own card on the author's board rather
        // than as anything attached to the note it answered. Nothing about A's original
        // note changed — there is no lifecycle for it to have moved through.
        await pageA.goto('/board');
        await expect(
          pageA.locator('[data-testid^="board-note-card-"]').filter({ hasText: REPLY_BODY }),
        ).toBeVisible({ timeout: 20_000 });
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `vertical-slice-e2e.spec.ts: process.env.${name} is unset — global-setup.ts did not run, or did not set it`,
    );
  }
  return value;
}
