// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { personalLinkShareBlurb, personalLinkUrl } from '../profile/personal-link-share';
import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';
import { dismissInviteHintForever, hasDismissedInviteHint } from '../welcome/invite-hint';

import { WelcomeInvitePopup } from './welcome-invite-popup';

/**
 * The welcome invite popup (issue #220), mounted over the fake API.
 *
 * What lives here: the two-tier dismissal contract (this visit vs. forever), the
 * storage gate, the delay gate, and the #160 share rule — `text` and `url` never
 * overlap. The delayed rise over a real screen is evidence-capture's job.
 */

const ENSURE_PATH = 'connections.personalLink.ensure';
const SLUG = 'abc-slug-123';

let tree: MountedTree | null = null;

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

function linkApi(): ReturnType<typeof createFakeApi> {
  return createFakeApi({ [ENSURE_PATH]: () => ({ slug: SLUG }) });
}

/** Mount with a zero delay, so the popup is open by the time the mount settles. */
async function mountOpen(api = linkApi()): Promise<MountedTree> {
  const mounted = await mountWithApi(<WelcomeInvitePopup delayMs={0} />, api);
  tree = mounted;
  await mounted.settle();

  return mounted;
}

function press(mounted: MountedTree, testId: string): Promise<void> {
  return mounted.run(() => {
    requireElement<HTMLButtonElement>(mounted.container, `[data-testid="${testId}"]`).click();
  });
}

describe('WelcomeInvitePopup', () => {
  it('rises with the personal link and Drew’s welcome line', async () => {
    const mounted = await mountOpen();

    requireElement(mounted.container, '[data-testid="welcome-invite-popup"]');
    expect(mounted.container.textContent).toContain('Welcome to the party!');
    expect(
      requireElement(mounted.container, '[data-testid="invite-hint-link"]').textContent,
    ).toBe(personalLinkUrl(window.location.origin, SLUG));
  });

  it('stays down before the delay has passed', async () => {
    // A delay far beyond what settle()'s zero-timeout turns can reach: the popup must
    // not exist yet, and — since the dialog owns the query — nothing may be fetched.
    const api = linkApi();
    tree = await mountWithApi(<WelcomeInvitePopup delayMs={60_000} />, api);

    expect(tree.container.querySelector('[data-testid="welcome-invite-popup"]')).toBeNull();
    expect(api.calls.length).toBe(0);
  });

  it('never rises on a device that said don’t show me again, and asks the server nothing', async () => {
    dismissInviteHintForever();

    const api = linkApi();
    tree = await mountWithApi(<WelcomeInvitePopup delayMs={0} />, api);
    await tree.settle();

    expect(tree.container.querySelector('[data-testid="welcome-invite-popup"]')).toBeNull();
    expect(api.calls.length).toBe(0);
  });

  it('Dismiss alone closes this visit only — the flag stays unwritten', async () => {
    const mounted = await mountOpen();

    await press(mounted, 'invite-hint-dismiss-button');

    expect(mounted.container.querySelector('[data-testid="welcome-invite-popup"]')).toBeNull();
    expect(hasDismissedInviteHint()).toBe(false);
  });

  it('Dismiss with the checkbox ticked writes the never-again flag', async () => {
    const mounted = await mountOpen();

    await press(mounted, 'invite-hint-dont-show-again');
    await press(mounted, 'invite-hint-dismiss-button');

    expect(mounted.container.querySelector('[data-testid="welcome-invite-popup"]')).toBeNull();
    expect(hasDismissedInviteHint()).toBe(true);
  });

  it('Escape honours the checkbox the same way the button does', async () => {
    const mounted = await mountOpen();

    await press(mounted, 'invite-hint-dont-show-again');
    await mounted.run(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(mounted.container.querySelector('[data-testid="welcome-invite-popup"]')).toBeNull();
    expect(hasDismissedInviteHint()).toBe(true);
  });

  it('shares blurb in text and link in url, never the link in both (issue #160)', async () => {
    const shares: Array<{ text?: string; url?: string }> = [];

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (payload: { text?: string; url?: string }) => {
        shares.push(payload);
        return Promise.resolve();
      },
    });

    try {
      const mounted = await mountOpen();

      await press(mounted, 'invite-hint-share-button');

      expect(shares).toEqual([
        {
          text: personalLinkShareBlurb(),
          url: personalLinkUrl(window.location.origin, SLUG),
        },
      ]);
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });

  it('takes focus on open, so Escape lands on the dialog’s own handler', async () => {
    const mounted = await mountOpen();

    expect(document.activeElement).toBe(
      requireElement(mounted.container, '[data-testid="welcome-invite-popup"]'),
    );
  });
});
