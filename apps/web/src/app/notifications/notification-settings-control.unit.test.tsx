// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { NotificationSettings } from '@playa-post/contracts';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type FakeApi,
  type MountedTree,
} from '../testing/mount-with-api';

import { NotificationSettingsControl } from './notification-settings-control';
import { NotificationsPanel } from './notifications-panel';

/**
 * The panel's per-kind switches (issue #209), over the fake API.
 *
 * ⚠ jsdom by the per-file pragma: the `unit` project runs in `node`, and only the files
 * that render React ask for a DOM.
 *
 * What lives here is the control's own contract — collapsed costs nothing, opening
 * reads, a tap flips optimistically and sends the right mutation, a refusal snaps the
 * switch back — plus the one assertion that the panel actually mounts it. The server's
 * half (what a flip *means* for delivery) is
 * `apps/server/.../notification-settings.integration.test.ts`'s subject.
 */
const GET_PATH = 'notifications.settings.get';
const UPDATE_PATH = 'notifications.settings.update';

const ALL_ON: NotificationSettings = {
  settings: [
    { kind: 'bulletins', enabled: true },
    { kind: 'note', enabled: true },
  ],
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

async function mountAndOpen(api: FakeApi): Promise<MountedTree> {
  const mounted = await mountWithApi(<NotificationSettingsControl />, api);

  await mounted.run(() => {
    requireElement<HTMLButtonElement>(
      mounted.container,
      '[data-testid="notification-settings-toggle"]',
    ).click();
  });

  return mounted;
}

function switchFor(mounted: MountedTree, kind: string): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(
    mounted.container,
    `[data-testid="notification-setting-${kind}"]`,
  );
}

describe('NotificationSettingsControl', () => {
  it('arrives collapsed and costs no request until opened', async () => {
    // An unrouted path makes the fake throw, so "no route needed" is load-bearing:
    // a mount that read the settings anyway would fail loudly right here.
    const api = createFakeApi({});

    tree = await mountWithApi(<NotificationSettingsControl />, api);

    expect(api.calls).toEqual([]);
    expect(tree.container.querySelector('[data-testid="notification-setting-bulletins"]')).toBeNull();
  });

  it('opens into one switch per kind, each carrying the server state', async () => {
    const api = createFakeApi({
      [GET_PATH]: (): NotificationSettings => ({
        settings: [
          { kind: 'bulletins', enabled: true },
          { kind: 'note', enabled: false },
        ],
      }),
    });

    const mounted = await mountAndOpen(api);

    tree = mounted;

    expect(api.calls).toEqual([{ kind: 'query', path: GET_PATH, input: undefined }]);
    expect(switchFor(mounted, 'bulletins').getAttribute('aria-checked')).toBe('true');
    expect(switchFor(mounted, 'note').getAttribute('aria-checked')).toBe('false');
    // Never colour alone: the state is also a word beside the switch.
    expect(switchFor(mounted, 'note').textContent).toContain('Off');
  });

  it('flips optimistically and sends the one mutation the tap means', async () => {
    // Stateful on purpose: `onSettled` refetches after the mutation, and a fake that kept
    // answering all-on would overwrite the very flip this test asserts.
    let current = ALL_ON;
    const api = createFakeApi({
      [GET_PATH]: () => current,
      [UPDATE_PATH]: (input): NotificationSettings => {
        current = {
          settings: current.settings.map((setting) =>
            setting.kind === (input as { kind: string }).kind
              ? { ...setting, enabled: (input as { enabled: boolean }).enabled }
              : setting,
          ),
        };

        return current;
      },
    });

    const mounted = await mountAndOpen(api);

    tree = mounted;
    await mounted.run(() => {
      switchFor(mounted, 'note').click();
    });

    expect(api.calls).toContainEqual({
      kind: 'mutate',
      path: UPDATE_PATH,
      input: { kind: 'note', enabled: false },
    });
    expect(switchFor(mounted, 'note').getAttribute('aria-checked')).toBe('false');
    // The neighbour did not move — a flip is one switch's, never the row's.
    expect(switchFor(mounted, 'bulletins').getAttribute('aria-checked')).toBe('true');
  });

  it('snaps the switch back when the server refuses the flip', async () => {
    const api = createFakeApi({
      [GET_PATH]: () => ALL_ON,
      [UPDATE_PATH]: () => {
        throw new Error('UNAUTHORIZED');
      },
    });

    const mounted = await mountAndOpen(api);

    tree = mounted;
    await mounted.run(() => {
      switchFor(mounted, 'note').click();
    });

    // `onSettled` refetches either way, and the refetch answers all-on — the switch
    // shows the server's truth rather than the optimistic write it could not keep.
    expect(switchFor(mounted, 'note').getAttribute('aria-checked')).toBe('true');
  });
});

describe('NotificationsPanel', () => {
  it('carries the settings toggle, beside the push offer it complements', async () => {
    tree = await mountWithApi(
      <NotificationsPanel onClose={() => undefined} />,
      createFakeApi({ 'notifications.list': () => [] }),
    );

    expect(
      tree.container.querySelector('[data-testid="notification-settings-toggle"]'),
    ).not.toBeNull();
  });
});
