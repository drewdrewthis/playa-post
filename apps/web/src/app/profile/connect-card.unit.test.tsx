// @vitest-environment jsdom
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { ConnectCard } from './connect-card';
import { inviteShareBlurb, inviteShareText } from './invite-share';

/**
 * The CONNECT card's three states, mounted over the fake API (PR #144 review).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 *
 * The success path's *appearance* — QR visible, background pinned white in both themes —
 * is `you-screen.spec.ts`'s job, where a real renderer computes real styles. What lives
 * here is what e2e cannot hold cheaply: the loading and error branches, and the
 * mint-count invariant that remounting the card inside a warm cache does not ask the
 * server to create again.
 */

const TOKEN = 'a-token-that-came-back';
const CREATE_PATH = 'connections.invitations.create';

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

function createCalls(api: { readonly calls: readonly { path: string }[] }): number {
  return api.calls.filter((call) => call.path === CREATE_PATH).length;
}

describe('ConnectCard', () => {
  it('shows the minting line while the invite is in flight', async () => {
    const api = createFakeApi({
      // Never settles — the card stays in flight for as long as the assertion needs.
      [CREATE_PATH]: () => new Promise(() => {}),
    });

    tree = await mountWithApi(<ConnectCard />, api);

    const quiet = requireElement(tree.container, '.profile__quiet');
    expect(quiet.textContent).toContain('Minting your invite');
    expect(tree.container.querySelector('[data-testid="invite-link"]')).toBeNull();
  });

  it('renders the refusal with a retry that asks again, and only then', async () => {
    let refuse = true;
    const api = createFakeApi({
      [CREATE_PATH]: () => {
        if (refuse) {
          throw new Error('the server refused this');
        }

        return { token: TOKEN, invitationId: 'inv-1', createdAt: new Date().toISOString() };
      },
    });

    tree = await mountWithApi(<ConnectCard />, api);

    const alert = requireElement(tree.container, '[role="alert"]');
    expect(alert.textContent).toContain('That invite did not get created');

    const retry = requireElement<HTMLButtonElement>(tree.container, 'button.profile__dial');
    expect(retry.textContent).toBe('TRY AGAIN');

    refuse = false;
    await tree.run(() => {
      retry.click();
    });

    const link = requireElement(tree.container, '[data-testid="invite-link"]');
    expect(link.textContent).toContain(TOKEN);
    // One refused, one honored — a retry that fired twice would be minting spares.
    expect(createCalls(api)).toBe(2);
  });

  it('does not ask the server again when the card remounts inside a warm cache', async () => {
    const api = createFakeApi({
      [CREATE_PATH]: () => ({
        token: TOKEN,
        invitationId: 'inv-1',
        createdAt: new Date().toISOString(),
      }),
    });

    tree = await mountWithApi(<ToggleableCard />, api);

    expect(createCalls(api)).toBe(1);

    const toggle = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="toggle-card"]',
    );

    // Away and back — the unmount/remount every navigation performs.
    await tree.run(() => {
      toggle.click();
    });
    expect(tree.container.querySelector('[data-testid="invite-link"]')).toBeNull();

    await tree.run(() => {
      toggle.click();
    });

    const link = requireElement(tree.container, '[data-testid="invite-link"]');
    expect(link.textContent).toContain(TOKEN);
    expect(createCalls(api)).toBe(1);
  });
});

/**
 * Issue #160: the share sheet's `text` field pasted the link a second time because it
 * carried the same link `url` was already carrying — the OS share sheet's own Copy
 * action reads both fields verbatim. These assert the two never overlap again, the
 * clipboard fallback stays self-contained, and the new copy affordance beside the link
 * does its own, separate job.
 *
 * ⚠ jsdom implements neither `navigator.share` nor `navigator.clipboard` by default, so
 * each test stubs only the one property it needs via `Object.defineProperty` — never
 * `vi.stubGlobal('navigator', ...)`, which would replace the whole jsdom `navigator` and
 * risk breaking whatever else here reads it. The `afterEach` below removes both own
 * properties again so a stub from one test cannot leak into the next.
 */
describe('sharing and copying the invite link', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    return writeTextMock;
  }

  function createReadyApi(): ReturnType<typeof createFakeApi> {
    return createFakeApi({
      [CREATE_PATH]: () => ({
        token: TOKEN,
        invitationId: 'inv-1',
        createdAt: new Date().toISOString(),
      }),
    });
  }

  /**
   * AC1 — the regression this issue fixes. `text` carries the blurb alone; the link
   * travels solely in `url`. Asserted twice: the exact payload shape, and then directly
   * that `text` does not contain the url, so a future edit to the blurb itself could not
   * quietly reintroduce the duplication and still pass the first assertion alone.
   */
  it('gives navigator.share a blurb-only text field alongside the url', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const link = requireElement(tree.container, '[data-testid="invite-link"]');
    const url = link.textContent ?? '';

    const shareButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="invite-share-button"]',
    );
    await tree.run(() => {
      shareButton.click();
    });

    expect(shareMock).toHaveBeenCalledWith({ text: inviteShareBlurb(), url });

    const [payload] = shareMock.mock.calls[0] as [{ text: string; url: string }];
    expect(payload.text).not.toContain(payload.url);
  });

  /** AC2 — with no share sheet, the clipboard gets the one field it has: blurb and link, combined. */
  it('writes the combined blurb-and-link form to the clipboard when there is no share sheet', async () => {
    const writeTextMock = stubClipboard();

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const link = requireElement(tree.container, '[data-testid="invite-link"]');
    const url = link.textContent ?? '';

    const shareButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="invite-share-button"]',
    );
    await tree.run(() => {
      shareButton.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith(inviteShareText(url));
  });

  /** AC3/AC4 — the standing copy affordance beside the link: bare url, transient confirmation. */
  it('copies the bare link from the copy button and confirms it', async () => {
    const writeTextMock = stubClipboard();

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const link = requireElement(tree.container, '[data-testid="invite-link"]');
    const url = link.textContent ?? '';

    const copyButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="copy-invite-link-button"]',
    );
    expect(copyButton.getAttribute('aria-label')).toBe('Copy invite link');

    await tree.run(() => {
      copyButton.click();
    });

    // Bare link — no blurb folded in, which is what makes this a distinct affordance
    // from the share button rather than a second way to trigger the same payload.
    expect(writeTextMock).toHaveBeenCalledWith(url);
    expect(copyButton.getAttribute('aria-label')).toBe('Copied');
  });
});

/** The card behind a switch, so one tree can unmount and remount it like a navigation. */
function ToggleableCard(): JSX.Element {
  const [shown, setShown] = useState(true);

  return (
    <div>
      <button
        data-testid="toggle-card"
        type="button"
        onClick={() => {
          setShown((current) => !current);
        }}
      >
        toggle
      </button>
      {shown ? <ConnectCard /> : null}
    </div>
  );
}
