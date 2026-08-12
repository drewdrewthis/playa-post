// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeApi, mountWithApi, requireElement, type MountedTree } from '../testing/mount-with-api';

import { SessionWait } from './session-wait';

/**
 * The full-screen wait (#200): a decorative animated mark over a polite live status.
 * The animation itself is CSS (`session-wait.css`, reduced-motion aware) and is not a
 * jsdom fact; what lives here is the accessibility contract — the status is announced,
 * the mark is not — and that the mark is the precached PWA icon, so the screen renders
 * even when the network is the thing being waited on.
 */

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

async function mount(element: Parameters<typeof mountWithApi>[0]): Promise<MountedTree> {
  // SessionWait reads nothing — an empty fake proves it (any read rejects loudly).
  tree = await mountWithApi(element, createFakeApi({}));

  return tree;
}

describe('SessionWait', () => {
  it('announces the headline politely, explains the wait, and hides the mark from assistive tech', async () => {
    const mounted = await mount(
      <SessionWait headline="Warming up the press…" detail="The server may be starting up." />,
    );

    const status = requireElement(mounted.container, '[role="status"]');
    expect(status.textContent).toBe('Warming up the press…');

    const detail = requireElement(mounted.container, '[data-testid="session-wait-detail"]');
    expect(detail.textContent).toBe('The server may be starting up.');

    const mark = requireElement(mounted.container, '[data-testid="session-wait-mark"]');
    expect(mark.getAttribute('src')).toBe('/pwa-192x192.png');
    expect(mark.getAttribute('alt')).toBe('');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders without a detail line when none is given', async () => {
    const mounted = await mount(<SessionWait headline="Restoring your session…" />);

    const status = requireElement(mounted.container, '[role="status"]');
    expect(status.textContent).toBe('Restoring your session…');
    expect(mounted.container.querySelector('[data-testid="session-wait-detail"]')).toBeNull();
  });
});
