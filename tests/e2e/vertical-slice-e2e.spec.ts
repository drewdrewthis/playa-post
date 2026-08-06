import { expect, test, type Page } from '@playwright/test';

/**
 * `specs/features/vertical-slice-e2e.feature` › "The full addendum §23 flow passes as
 * eleven named steps" (M2-AC1). The only browser-driven test in M2
 * (`m2-lane-briefs.md` §"What `@e2e` means in a lane"). Two browser contexts, eleven
 * named `test.step()`s matching the feature table verbatim, real backend
 * (`tests/e2e/global-setup.ts`), real Postgres, real tRPC router. The only mocked
 * boundary this run touches is the Supabase Auth JWT issuer (see
 * `tests/e2e/support/mock-supabase-jwt-issuer.ts`) — Web Push is not yet exercised
 * because `modules/notifications` has not merged (see step 9's note below).
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
 * | `invite-create-button` | graph home | Mint a new invite |
 * | `invite-token-display` | graph home | Renders the just-minted invite token/link as text |
 * | `invite-open-view` | `/invite/:token` | Preview of who the token invites the viewer to connect with |
 * | `invite-accept-button` | `/invite/:token` | Spend the token and accept the connection |
 * | `connection-accepted-banner` | post-accept | Confirms the connection is now active |
 * | `graph-connection-node-<handle>` | graph home | One connected person's node, clickable to open their person sheet |
 * | `person-sheet-save-trust-button` | person sheet | Persists the trust slider's value |
 * | `graph-connection-edge-<handle>` | graph home | Visible edge/row proving the connection rendered for this viewer |
 * | `compose-bulletin-button` | graph home / board | Opens the compose form |
 * | `compose-bulletin-type-select` | compose form | `<select>` with an accessible name "Type"; values include `request` |
 * | `compose-bulletin-title-input` | compose form | Title field |
 * | `compose-bulletin-body-input` | compose form | Body field |
 * | `compose-bulletin-submit-button` | compose form | Posts the bulletin |
 * | `board-bulletin-card-<bulletinId>` | board | One bulletin's card. Carries `data-archived="true"` once archived |
 * | `notifications-bell-button` | app shell | Opens the notifications panel |
 * | `notification-grouped-item` | notifications panel | One grouped Notify Me notification |
 * | `bulletin-dismiss-button` | inside a `board-bulletin-card-*` | Privately dismiss this bulletin for the viewer |
 * | `bulletin-report-button` | inside a `board-bulletin-card-*` | Privately report this bulletin (alternative to dismiss, step 10 accepts either) |
 * | `bulletin-archive-button` | inside a `board-bulletin-card-*`, author only | Archive the bulletin |
 * | `offline-pending-badge` | app shell | Visible while a mutation is queued/pending/inflight per the offline store (ADR-0005:105-107); hidden once synced |
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

      await test.step('2. User A creates an invite', async () => {
        await pageA.getByTestId('invite-create-button').click();
        inviteToken = (await pageA.getByTestId('invite-token-display').innerText()).trim();
        expect(inviteToken.length).toBeGreaterThan(0);
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

      // `modules/notifications` (L3b-notify) has not merged into this branch's base —
      // `git log` shows L1, L2, L3a, and L3b-infra only. This step therefore has no
      // Notify Me query, no push subscription table, and no notification UI to drive
      // yet; it fails the moment the coder reaches it, for that reason, until
      // L3b-notify lands. See `tests/e2e/support/mock-web-push-transport.ts`'s doc
      // comment for the mock this step will need once it does.
      await test.step('9. Notify Me produces a grouped notification for a matching viewer', async () => {
        await pageB.getByTestId('notifications-bell-button').click();
        await expect(pageB.getByTestId('notification-grouped-item')).toBeVisible();
      });

      await test.step('10. User B dismisses or privately reports the bulletin', async () => {
        const card = pageB.getByTestId(`board-bulletin-card-${bulletinId}`);
        await card.getByTestId('bulletin-dismiss-button').click();
        await expect(card).toBeHidden();
      });

      await test.step(
        '11. User A archives the bulletin, and one mutation replays from offline state',
        async () => {
          await pageA.goto('/board');
          await contextA.setOffline(true);
          await pageA
            .getByTestId(`board-bulletin-card-${bulletinId}`)
            .getByTestId('bulletin-archive-button')
            .click();
          await expect(pageA.getByTestId('offline-pending-badge')).toBeVisible();

          await contextA.setOffline(false);
          await expect(pageA.getByTestId('offline-pending-badge')).toBeHidden();
          await expect(pageA.getByTestId(`board-bulletin-card-${bulletinId}`)).toHaveAttribute(
            'data-archived',
            'true',
          );
        },
      );
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
