import { expect, type Page } from '@playwright/test';

/** The personal-link route's path segment — see `app/profile/personal-link-share.ts`. */
const PERSONAL_LINK_PATH_SEGMENT = '/c/';

/**
 * Read the signed-in user's personal-link slug off the You screen.
 *
 * **The You screen's CONNECT card is the only place a link comes from**, and since
 * [#206](https://github.com/drewdrewthis/playa-post/issues/206) what it carries is a
 * permanent personal link rather than a freshly minted single-use invite token. The graph
 * screen has never had a control for this ([#142](https://github.com/drewdrewthis/playa-post/issues/142),
 * [#90](https://github.com/drewdrewthis/playa-post/issues/90)).
 *
 * ⚠ **There is nothing to click.** The card ensures the link on arrival, so the wait for
 * `personal-link` *is* the wait for `connections.personalLink.ensure` to answer — hence a
 * timeout well above the default, since a cold server is answering its first write.
 *
 * ⚠ **The slug comes back percent-encoded, exactly as the link carries it**, because every
 * caller interpolates it straight back into a path. Decoding it here would hand back a
 * string that no longer round-trips.
 *
 * Leaves the page on `/you`.
 */
export async function readPersonalLinkSlug(page: Page): Promise<string> {
  await page.goto('/you');

  const link = page.getByTestId('personal-link');
  await expect(link).toBeVisible({ timeout: 15_000 });

  const shareUrl = (await link.innerText()).trim();
  const [, slug = ''] = shareUrl.split(PERSONAL_LINK_PATH_SEGMENT);
  expect(slug, `expected a ${PERSONAL_LINK_PATH_SEGMENT} link, got: ${shareUrl}`).not.toBe('');

  return slug;
}

/**
 * Open somebody's personal link and ask to connect.
 *
 * ⚠ **This connects nobody**, which is the entire point of #206 and the reason this is a
 * separate exported step rather than folded into {@link connectViaPersonalLink}: a spec
 * asserting that opening a link does *not* produce an edge needs to stop here.
 *
 * Leaves the page on `/c/:slug` showing the sent state.
 */
export async function sendConnectionRequest(page: Page, slug: string): Promise<void> {
  await page.goto(`${PERSONAL_LINK_PATH_SEGMENT}${slug}`);
  await expect(page.getByTestId('personal-link-view')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('send-connection-request-button').click();
  await expect(page.getByTestId('connection-request-sent')).toBeVisible();
}

/**
 * Accept the request waiting at the top of the owner's inbox.
 *
 * The inbox lives on the graph screen, above the intro inbox, and renders nothing at all
 * when empty — so the wait for the row is the wait for `connections.requests.listInbox`.
 *
 * ⚠ **The connection exists the moment this resolves**, unlike an accepted introduction,
 * which waits on the outbox drainer (ADR-0017 D9). Accepting a connection request writes
 * `app.connections` in the same transaction (ADR-0018 D7), so callers may assert on the
 * graph immediately rather than polling a reload.
 *
 * Leaves the page on `/graph`.
 */
export async function acceptConnectionRequest(page: Page): Promise<void> {
  await page.goto('/graph');

  const row = page.getByTestId('connection-request-row').first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByTestId('connection-request-accept-button').click();
  await expect(page.getByTestId('connection-request-inbox-confirmation')).toBeVisible();
}

/**
 * Connect two already-signed-in users through `owner`'s personal link, end to end.
 *
 * The three-step replacement for the old `mintInviteViaYouScreen` + `/invite/:token` +
 * accept dance. Every spec that needs two users genuinely connected bootstraps through
 * here rather than re-deriving the path — and the path is now three acts by two people
 * rather than one act by one, because that is what mutual consent costs.
 *
 * ⚠ **Both pages must already have a session.** This helper never signs anybody in; the
 * requester needs an identity before they can be named as one.
 *
 * Leaves `owner` on `/graph` and `requester` on the link screen.
 */
export async function connectViaPersonalLink(owner: Page, requester: Page): Promise<void> {
  const slug = await readPersonalLinkSlug(owner);

  await requester.goto(`${PERSONAL_LINK_PATH_SEGMENT}${slug}`);
  await expect(requester.getByTestId('personal-link-view')).toBeVisible({ timeout: 15_000 });

  /*
   * ⚠ Idempotent for an already-connected pair, and it has to be: `global-setup.ts`
   * pre-connects A—B for the intro path's degree-2 chain, and earlier spec files in the
   * same run leave their own edges behind. The old invite flow tolerated that because
   * `AcceptInviteService` resolved a connected pair idempotently; here the link screen
   * shows the already-connected banner and no send button at all, so pressing on would
   * wait out the whole test timeout for a control that never renders.
   */
  if (await requester.getByTestId('personal-link-connected').isVisible()) {
    return;
  }

  await requester.getByTestId('send-connection-request-button').click();
  await expect(requester.getByTestId('connection-request-sent')).toBeVisible();
  await acceptConnectionRequest(owner);
}
