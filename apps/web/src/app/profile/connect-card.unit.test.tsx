// @vitest-environment jsdom
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { ConnectCard } from './connect-card';

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
