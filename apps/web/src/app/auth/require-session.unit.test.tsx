// @vitest-environment jsdom
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type FakeApiRoutes,
  type MountedTree,
} from '../testing/mount-with-api';

import { RequireSession } from './require-session';
import { SessionProvider } from './session-provider';
import type { AuthClient } from './supabase-auth-client';

/**
 * Pins which screen each session-gate state shows (#200): the two *waits* get the
 * animated `SessionWait` and its copy, offline gets still text and no mark, and a
 * settled probe gets the children. The e2e never crosses these states (it seeds a
 * token and lands signed-in), and that job is advisory besides — this is the
 * assertion that lives in branch-protected CI.
 */

/** An auth client pinned to one answer; `currentSession` never resolving = `loading`. */
function createAuthClient(currentSession: Promise<{ accessToken: string } | null>): AuthClient {
  return {
    currentSession: () => currentSession,
    requestSignInLink: () => Promise.resolve(),
    verifySignInCode: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onSessionChange: () => () => undefined,
  };
}

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

async function mountGate(
  currentSession: Promise<{ accessToken: string } | null>,
  routes: FakeApiRoutes,
): Promise<MountedTree> {
  tree = await mountWithApi(
    <MemoryRouter>
      <SessionProvider authClient={createAuthClient(currentSession)}>
        <RequireSession>
          <p data-testid="gated-children">the app</p>
        </RequireSession>
      </SessionProvider>
    </MemoryRouter>,
    createFakeApi(routes),
  );

  return tree;
}

const signedIn = Promise.resolve({ accessToken: 'test-token' });

describe('RequireSession waiting states', () => {
  it('shows the restoring wait, mark and all, while the session is still unknown', async () => {
    // A promise that never settles holds the provider in `loading`.
    const mounted = await mountGate(new Promise(() => undefined), {});

    const status = requireElement(mounted.container, '[role="status"]');
    expect(status.textContent).toBe('Restoring your session…');
    expect(mounted.container.querySelector('[data-testid="session-wait-mark"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="gated-children"]')).toBeNull();
  });

  it('owns the cold start while the probe is in flight', async () => {
    const mounted = await mountGate(signedIn, {
      'graph.list': () => new Promise(() => undefined),
    });

    const status = requireElement(mounted.container, '[role="status"]');
    expect(status.textContent).toBe('Warming up the press…');

    const detail = requireElement(mounted.container, '[data-testid="session-wait-detail"]');
    expect(detail.textContent).toBe(
      'The server may be waking up — the first load can take a moment.',
    );
    expect(mounted.container.querySelector('[data-testid="session-wait-mark"]')).not.toBeNull();
  });

  it('answers a transport failure with still text — no mark, no spinner', async () => {
    const mounted = await mountGate(signedIn, {
      'graph.list': () => {
        throw new Error('network down');
      },
    });

    expect(mounted.container.textContent).toContain(
      'You are offline. Reconnect to load this view.',
    );
    expect(mounted.container.querySelector('[data-testid="session-wait-mark"]')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="gated-children"]')).toBeNull();
  });

  it('hands over to the children once the probe answers', async () => {
    const mounted = await mountGate(signedIn, {
      'graph.list': () => ({ people: [], connections: [] }),
    });

    expect(mounted.container.querySelector('[data-testid="gated-children"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="session-wait-mark"]')).toBeNull();
  });
});
