import { expect, type Page } from '@playwright/test';

/** The invite route's path segment — see `app/profile/invite-share.ts`'s `inviteUrl`. */
const INVITE_PATH_SEGMENT = '/invite/';

/**
 * Mint an invite as the page's signed-in user, and return its token.
 *
 * **The graph screen no longer mints anything.** The comp has no invite control there at
 * all — the button that used to sit in its header was a remnant of the pre-design wave
 * ([#142](https://github.com/drewdrewthis/playa-post/issues/142)) — so the You screen's
 * CONNECT card is the only place an invite comes from
 * ([#90](https://github.com/drewdrewthis/playa-post/issues/90)). Every spec that needs two
 * users genuinely connected bootstraps through here rather than re-deriving that path.
 *
 * ⚠ **There is nothing to click.** The card mints on arrival, so the wait for
 * `invite-link` *is* the wait for `connections.invitations.create` to answer — hence a
 * timeout well above the default, since a cold server is answering its first write.
 *
 * ⚠ **The token comes back percent-encoded, exactly as the link carries it**, because
 * every caller interpolates it straight back into a path. Decoding it here would hand back
 * a string that no longer round-trips.
 *
 * Leaves the page on `/you`. Callers needing another screen navigate themselves, which
 * costs nothing: the tab bar's compose FAB is on every authenticated screen, and the specs
 * that need the graph already `goto('/graph')` for their own reasons.
 */
export async function mintInviteViaYouScreen(page: Page): Promise<string> {
  await page.goto('/you');

  const link = page.getByTestId('invite-link');
  await expect(link).toBeVisible({ timeout: 15_000 });

  const shareUrl = (await link.innerText()).trim();
  const [, token = ''] = shareUrl.split(INVITE_PATH_SEGMENT);
  expect(token, `expected an ${INVITE_PATH_SEGMENT} link, got: ${shareUrl}`).not.toBe('');

  return token;
}
