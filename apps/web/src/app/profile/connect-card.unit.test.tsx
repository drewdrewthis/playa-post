// @vitest-environment jsdom
import { act, useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { COPIED_HOLD_MS, ConnectCard } from './connect-card';
import { personalLinkShareBlurb, personalLinkShareText } from './personal-link-share';

/**
 * The CONNECT card's states, mounted over the fake API (PR #144 review, reworked for
 * issue #206).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 *
 * ⚠ **The card shares a personal link now, not an invite token.** Nothing here calls
 * `connections.invitations.create` any more, and a test that reintroduced it would be
 * putting the spendable model back in front of users — the failure #206 was filed for.
 *
 * The success path's *appearance* — QR visible, background pinned white in both themes —
 * is `you-screen.spec.ts`'s job, where a real renderer computes real styles. What lives
 * here is what e2e cannot hold cheaply: the loading and error branches, the mint-count
 * invariant that remounting inside a warm cache does not ask the server again, and the
 * rotation behaviour that must never happen by accident.
 */

const SLUG = 'aSlugThatCameBack00000';
const ROTATED_SLUG = 'aFreshSlugAfterRotate1';
const ENSURE_PATH = 'connections.personalLink.ensure';
const ROTATE_PATH = 'connections.personalLink.rotate';

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

function callsTo(
  api: { readonly calls: readonly { path: string }[] },
  path: string,
): number {
  return api.calls.filter((call) => call.path === path).length;
}

/** What the server answers for a link that already exists. */
function linkPayload(slug: string): { slug: string; createdAt: string } {
  return { slug, createdAt: '2026-08-01T00:00:00.000Z' };
}

describe('ConnectCard', () => {
  it('shows the waiting line while the link is in flight', async () => {
    const api = createFakeApi({
      // Never settles — the card stays in flight for as long as the assertion needs.
      [ENSURE_PATH]: () => new Promise(() => {}),
    });

    tree = await mountWithApi(<ConnectCard />, api);

    const quiet = requireElement(tree.container, '.profile__quiet');
    expect(quiet.textContent).toContain('Getting your link');
    expect(tree.container.querySelector('[data-testid="personal-link"]')).toBeNull();
  });

  it('renders the refusal with a retry that asks again, and only then', async () => {
    let refuse = true;
    const api = createFakeApi({
      [ENSURE_PATH]: () => {
        if (refuse) {
          throw new Error('the server refused this');
        }

        return linkPayload(SLUG);
      },
    });

    tree = await mountWithApi(<ConnectCard />, api);

    const alert = requireElement(tree.container, '[role="alert"]');
    expect(alert.textContent).toContain('Your link did not load');

    const retry = requireElement<HTMLButtonElement>(tree.container, 'button.profile__dial');
    expect(retry.textContent).toBe('TRY AGAIN');

    refuse = false;
    await tree.run(() => {
      retry.click();
    });

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    expect(link.textContent).toContain(SLUG);
    // One refused, one honored — a retry that fired twice would be asking twice for a
    // resource whose first call is the one that might mint.
    expect(callsTo(api, ENSURE_PATH)).toBe(2);
  });

  it('does not ask the server again when the card remounts inside a warm cache', async () => {
    const api = createFakeApi({ [ENSURE_PATH]: () => linkPayload(SLUG) });

    tree = await mountWithApi(<ToggleableCard />, api);

    expect(callsTo(api, ENSURE_PATH)).toBe(1);

    const toggle = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="toggle-card"]',
    );

    // Away and back — the unmount/remount every navigation performs.
    await tree.run(() => {
      toggle.click();
    });
    expect(tree.container.querySelector('[data-testid="personal-link"]')).toBeNull();

    await tree.run(() => {
      toggle.click();
    });

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    expect(link.textContent).toContain(SLUG);
    expect(callsTo(api, ENSURE_PATH)).toBe(1);
  });

  /*
   * ⚠ **The one bug this card could have, and it would be silent** (issue #206): if
   * arriving on the screen rotated, the card would show a working link while every copy
   * already shared stopped resolving. The server's `on conflict (owner_id)` is what
   * prevents it; this asserts the client never asks for one either.
   */
  it('never calls rotate on its own — arriving on the screen is not a rotation', async () => {
    const api = createFakeApi({
      [ENSURE_PATH]: () => linkPayload(SLUG),
      [ROTATE_PATH]: () => linkPayload(ROTATED_SLUG),
    });

    tree = await mountWithApi(<ToggleableCard />, api);
    const toggle = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="toggle-card"]',
    );
    await tree.run(() => {
      toggle.click();
    });
    await tree.run(() => {
      toggle.click();
    });

    expect(callsTo(api, ROTATE_PATH)).toBe(0);
  });

  it('replaces the link on screen the moment a rotation lands, and says so', async () => {
    const api = createFakeApi({
      [ENSURE_PATH]: () => linkPayload(SLUG),
      [ROTATE_PATH]: () => ({ ...linkPayload(ROTATED_SLUG), rotatedAt: '2026-08-13T12:00:00.000Z' }),
    });

    tree = await mountWithApi(<ConnectCard />, api);

    const rotateButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="rotate-personal-link-button"]',
    );
    await tree.run(() => {
      rotateButton.click();
    });

    // ⚠ The new slug has to be on screen *immediately*. The mutation already returned the
    // authoritative row, so the card writes it into the cache rather than invalidating into
    // a refetch — a refetch would leave a window showing the old, now-dead URL.
    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    expect(link.textContent).toContain(ROTATED_SLUG);
    expect(link.textContent).not.toContain(SLUG);

    const banner = requireElement(tree.container, '[data-testid="personal-link-rotated"]');
    expect(banner.textContent).toContain('no longer opens');
    // One rotation per press. A second call would retire the link the user was just shown.
    expect(callsTo(api, ROTATE_PATH)).toBe(1);
  });

  it('keeps the current link on screen when a rotation is refused', async () => {
    const api = createFakeApi({
      [ENSURE_PATH]: () => linkPayload(SLUG),
      [ROTATE_PATH]: () => {
        throw new Error('the server refused this');
      },
    });

    tree = await mountWithApi(<ConnectCard />, api);

    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="rotate-personal-link-button"]',
      ).click();
    });

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    expect(link.textContent).toContain(SLUG);
    const error = requireElement(tree.container, '[data-testid="rotate-personal-link-error"]');
    expect(error.textContent).toContain('still opens');
    expect(tree.container.querySelector('[data-testid="personal-link-rotated"]')).toBeNull();
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
describe('sharing and copying the personal link', () => {
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
    return createFakeApi({ [ENSURE_PATH]: () => linkPayload(SLUG) });
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

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    const url = link.textContent ?? '';

    const shareButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="personal-link-share-button"]',
    );
    await tree.run(() => {
      shareButton.click();
    });

    expect(shareMock).toHaveBeenCalledWith({ text: personalLinkShareBlurb(), url });

    const [payload] = shareMock.mock.calls[0] as [{ text: string; url: string }];
    expect(payload.text).not.toContain(payload.url);
  });

  /** AC2 — with no share sheet, the clipboard gets the one field it has: blurb and link, combined. */
  it('writes the combined blurb-and-link form to the clipboard when there is no share sheet', async () => {
    const writeTextMock = stubClipboard();

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    const url = link.textContent ?? '';

    const shareButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="personal-link-share-button"]',
    );
    await tree.run(() => {
      shareButton.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith(personalLinkShareText(url));
  });

  /** AC3/AC4 — the standing copy affordance beside the link: bare url, transient confirmation. */
  it('copies the bare link from the copy button and confirms it', async () => {
    const writeTextMock = stubClipboard();

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const link = requireElement(tree.container, '[data-testid="personal-link"]');
    const url = link.textContent ?? '';

    const copyButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="copy-personal-link-button"]',
    );
    expect(copyButton.getAttribute('aria-label')).toBe('Copy your link');

    await tree.run(() => {
      copyButton.click();
    });

    // Bare link — no blurb folded in, which is what makes this a distinct affordance
    // from the share button rather than a second way to trigger the same payload.
    expect(writeTextMock).toHaveBeenCalledWith(url);
    expect(copyButton.getAttribute('aria-label')).toBe('Copied');
  });

  /** AC5 — the "Copied" confirmation is transient: it reverts once `COPIED_HOLD_MS` passes. */
  it('reverts the "Copied" confirmation back to the resting label after the hold', async () => {
    stubClipboard();

    tree = await mountWithApi(<ConnectCard />, createReadyApi());

    const copyButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="copy-personal-link-button"]',
    );

    await tree.run(() => {
      copyButton.click();
    });
    expect(copyButton.getAttribute('aria-label')).toBe('Copied');

    // Real time, not `vi.useFakeTimers()`: `mountWithApi`'s own `settle()` flushes through
    // a real `setTimeout(resolve, 0)`, and faking the clock here would freeze that right
    // alongside the button's own revert timer. Waiting past `COPIED_HOLD_MS` for real,
    // wrapped in `act` the same way `settle()` is, is what lets React apply the timer's
    // `setCopied(false)` before the assertion below reads the DOM.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, COPIED_HOLD_MS + 50);
      });
    });

    expect(copyButton.getAttribute('aria-label')).toBe('Copy your link');
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
