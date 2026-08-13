// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { PERSONAL_LINK_VIEWER_STATE } from '@playa-post/contracts';

import {
  ALREADY_CONNECTED_LINE,
  CONNECTION_REQUEST_SENT_LINE,
  OWN_LINK_LINE,
  PERSONAL_LINK_ASK_LINE,
  PERSONAL_LINK_UNAVAILABLE_LINE,
} from '../connections/connection-request-copy';
import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { PersonalLinkOpenRoute } from './personal-link-open';

/**
 * `/c/:slug` — the screen that replaces one-tap invite acceptance (issue #206).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 *
 * ⚠ `mountWithApi` provides no router, so the route is wrapped in a `MemoryRouter` here —
 * the same shape `deep-link-return.unit.test.tsx` uses — because the component reads its
 * slug from `useParams`.
 */
const OPEN_PATH = 'connections.personalLink.open';
const SEND_PATH = 'connections.requests.send';
const SLUG = 'aSlugFromSomebody00000';

const OWNER = {
  userId: '11111111-1111-4111-8111-111111111111',
  disclosure: 'full',
  displayName: 'Dusty',
  handle: 'dusty',
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;
  tree = null;
  if (mounted !== null) {
    await mounted.unmount();
  }
});

function mount(api: ReturnType<typeof createFakeApi>): Promise<MountedTree> {
  return mountWithApi(
    <MemoryRouter initialEntries={[`/c/${SLUG}`]}>
      <Routes>
        <Route path="/c/:slug" element={<PersonalLinkOpenRoute />} />
      </Routes>
    </MemoryRouter>,
    api,
  );
}

function openedAs(viewerState: string): ReturnType<typeof createFakeApi> {
  return createFakeApi({ [OPEN_PATH]: () => ({ owner: OWNER, viewerState }) });
}

describe('PersonalLinkOpenRoute', () => {
  it('names the owner and offers a request, not a connection', async () => {
    tree = await mount(openedAs(PERSONAL_LINK_VIEWER_STATE.open));

    const view = requireElement(tree.container, '[data-testid="personal-link-view"]');
    expect(view.textContent).toContain('Dusty');

    /*
     * ⚠ **The load-bearing assertion of this whole screen.** Somebody arriving from a QR
     * expects a tap to connect them — that is what the link this replaces did, and the
     * mismatch is what produced #206. The sentence correcting the expectation has to be
     * present *before* the button is pressed, so it is asserted on the resting screen.
     */
    expect(view.textContent).toContain(PERSONAL_LINK_ASK_LINE);
    expect(
      requireElement(tree.container, '[data-testid="send-connection-request-button"]').textContent,
    ).toBe('Send connection request');
  });

  it('opening calls no mutation at all — a read cannot connect anybody', async () => {
    const api = openedAs(PERSONAL_LINK_VIEWER_STATE.open);

    tree = await mount(api);

    expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([]);
  });

  it('sends the slug from the URL, and only on the press', async () => {
    const api = createFakeApi({
      [OPEN_PATH]: () => ({ owner: OWNER, viewerState: PERSONAL_LINK_VIEWER_STATE.open }),
      [SEND_PATH]: () => ({ id: 'req-1', status: 'pending', createdAt: '2026-08-13T12:00:00.000Z' }),
    });

    tree = await mount(api);
    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="send-connection-request-button"]',
      ).click();
    });

    const sends = api.calls.filter((call) => call.path === SEND_PATH);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.input).toEqual({ slug: SLUG });
  });

  /*
   * ⚠ **Every failed resolution is one screen with one sentence.** Unknown slug, malformed
   * slug, deactivated owner, and a slug the owner has *rotated away from* all arrive here as
   * the same `PERSONAL_LINK_UNAVAILABLE`, and the client must not invent a distinction the
   * server spent its design refusing to make. The rotated case is the one that matters:
   * whoever kept the old URL is frequently the reason it was rotated.
   */
  it('renders the neutral unavailable line for a refused link, naming no cause', async () => {
    tree = await mount(
      createFakeApi({
        [OPEN_PATH]: () => {
          throw new Error('the server refused this');
        },
      }),
    );

    const notice = requireElement(tree.container, '[data-testid="personal-link-notice"]');
    expect(notice.textContent).toBe(PERSONAL_LINK_UNAVAILABLE_LINE);
    expect(notice.textContent?.toLowerCase()).not.toContain('rotat');
    expect(notice.textContent?.toLowerCase()).not.toContain('retire');
    expect(notice.textContent?.toLowerCase()).not.toContain('expire');
    expect(tree.container.querySelector('[data-testid="send-connection-request-button"]')).toBeNull();
  });

  describe('the three states that are not a request', () => {
    it('tells the owner it is their own link and offers no request button', async () => {
      tree = await mount(openedAs(PERSONAL_LINK_VIEWER_STATE.own));

      expect(
        requireElement(tree.container, '[data-testid="personal-link-own"]').textContent,
      ).toBe(OWN_LINK_LINE);
      expect(
        tree.container.querySelector('[data-testid="send-connection-request-button"]'),
      ).toBeNull();
    });

    it('tells an existing connection there is nothing to ask for', async () => {
      tree = await mount(openedAs(PERSONAL_LINK_VIEWER_STATE.connected));

      expect(
        requireElement(tree.container, '[data-testid="personal-link-connected"]').textContent,
      ).toBe(ALREADY_CONNECTED_LINE);
      expect(
        tree.container.querySelector('[data-testid="send-connection-request-button"]'),
      ).toBeNull();
    });

    /*
     * ⚠ **The sent state comes from the server's `viewerState`, not from a local flag.** A
     * reload would lose a local one, and the person would send a second request that the
     * server refuses — which reads as the app being broken.
     *
     * ⚠ And it promises no answer: an owner may decline, and a decline reaches nobody, so
     * "we will let you know" would be false in exactly the case the reader most wants.
     */
    it('shows the sent state for somebody who already asked, and promises no answer', async () => {
      tree = await mount(openedAs(PERSONAL_LINK_VIEWER_STATE.requested));

      const sent = requireElement(tree.container, '[data-testid="connection-request-sent"]');
      expect(sent.textContent).toBe(CONNECTION_REQUEST_SENT_LINE);
      expect(sent.textContent?.toLowerCase()).not.toContain('notify');
      expect(sent.getAttribute('role')).toBe('status');
      expect(
        tree.container.querySelector('[data-testid="send-connection-request-button"]'),
      ).toBeNull();
    });
  });
});
