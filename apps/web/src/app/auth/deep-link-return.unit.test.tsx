// @vitest-environment jsdom
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignInRoute } from '../routes/sign-in';
import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { RequireSession } from './require-session';
import { SessionProvider } from './session-provider';
import type { AuthClient } from './supabase-auth-client';

/**
 * Pins the deep-link round trip (#205): an address `RequireSession` interrupts must
 * come back out of sign-in. Each hop is asserted through real routes in a memory
 * router — the capture (anonymous visitor bounced with state), and the return (a
 * signed-in arrival at `/signin` landing on the forwarded path, or `/` without one).
 */

function createAuthClient(session: { accessToken: string } | null): AuthClient {
  return {
    currentSession: () => Promise.resolve(session),
    requestSignInLink: () => Promise.resolve(),
    verifySignInCode: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onSessionChange: () => () => undefined,
  };
}

/** Renders where the router actually is, so a test can assert on the landing. */
function LocationProbe({ label }: { readonly label: string }): JSX.Element {
  const location = useLocation();

  return (
    <p data-testid={`probe-${label}`} data-state={JSON.stringify(location.state)}>
      {location.pathname}
    </p>
  );
}

let tree: MountedTree | null = null;

beforeEach(() => {
  // The has-seen-welcome flag decides which screen an anonymous bounce lands on;
  // start each test from the never-seen default.
  globalThis.localStorage.clear();
});

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

describe('capture: RequireSession preserves the interrupted address', () => {
  async function mountAnonymousVisit(): Promise<MountedTree> {
    tree = await mountWithApi(
      <MemoryRouter initialEntries={['/invite/abc123?ref=qr']}>
        <SessionProvider authClient={createAuthClient(null)}>
          <Routes>
            <Route path="/welcome" element={<LocationProbe label="welcome" />} />
            <Route path="/signin" element={<LocationProbe label="signin" />} />
            <Route
              path="/invite/:token"
              element={
                <RequireSession>
                  <p data-testid="gated-children">the invite</p>
                </RequireSession>
              }
            />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
      createFakeApi({}),
    );

    return tree;
  }

  it('sends a first-ever visitor to welcome, carrying the invite address as state', async () => {
    const mounted = await mountAnonymousVisit();

    const probe = requireElement(mounted.container, '[data-testid="probe-welcome"]');
    expect(probe.textContent).toBe('/welcome');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toEqual({
      from: '/invite/abc123?ref=qr',
    });
  });

  it('sends a returning signed-out visitor to sign-in, carrying the same state', async () => {
    globalThis.localStorage.setItem('playapost-onboarded', '1');

    const mounted = await mountAnonymousVisit();

    const probe = requireElement(mounted.container, '[data-testid="probe-signin"]');
    expect(probe.textContent).toBe('/signin');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toEqual({
      from: '/invite/abc123?ref=qr',
    });
  });
});

describe('capture: the mid-session probe refusals also preserve the address', () => {
  async function mountProbeRefusal(code: 'UNAUTHORIZED' | 'FORBIDDEN'): Promise<MountedTree> {
    const refusal = Object.assign(new Error(code), { data: { code } });

    tree = await mountWithApi(
      <MemoryRouter initialEntries={['/invite/abc123']}>
        <SessionProvider authClient={createAuthClient({ accessToken: 'test-token' })}>
          <Routes>
            <Route path="/signin" element={<LocationProbe label="signin" />} />
            <Route path="/onboarding" element={<LocationProbe label="onboarding" />} />
            <Route
              path="/invite/:token"
              element={
                <RequireSession>
                  <p data-testid="gated-children">the invite</p>
                </RequireSession>
              }
            />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
      createFakeApi({
        'graph.list': () => {
          throw refusal;
        },
      }),
    );

    return tree;
  }

  it('UNAUTHORIZED bounces to sign-in with the address as state', async () => {
    // A refused token also clears the session, and the anonymous bounce can win the
    // render race — mark welcome seen so both paths point at /signin, which is where
    // a real device that has signed in before would land anyway.
    globalThis.localStorage.setItem('playapost-onboarded', '1');

    const mounted = await mountProbeRefusal('UNAUTHORIZED');

    const probe = requireElement(mounted.container, '[data-testid="probe-signin"]');
    expect(probe.textContent).toBe('/signin');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toEqual({
      from: '/invite/abc123',
    });
  });

  it('FORBIDDEN bounces to onboarding with the address as state', async () => {
    const mounted = await mountProbeRefusal('FORBIDDEN');

    const probe = requireElement(mounted.container, '[data-testid="probe-onboarding"]');
    expect(probe.textContent).toBe('/onboarding');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toEqual({
      from: '/invite/abc123',
    });
  });
});

describe('return: SignInRoute honours the forwarded address once signed in', () => {
  async function mountSignedInArrival(state: unknown): Promise<MountedTree> {
    tree = await mountWithApi(
      <MemoryRouter initialEntries={[{ pathname: '/signin', state }]}>
        <SessionProvider authClient={createAuthClient({ accessToken: 'test-token' })}>
          <Routes>
            <Route path="/signin" element={<SignInRoute />} />
            <Route path="/" element={<LocationProbe label="home" />} />
            <Route path="/invite/:token" element={<LocationProbe label="invite" />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
      createFakeApi({}),
    );

    return tree;
  }

  it('lands on the forwarded path, query and all', async () => {
    const mounted = await mountSignedInArrival({ from: '/invite/abc123?ref=qr' });

    const probe = requireElement(mounted.container, '[data-testid="probe-invite"]');
    expect(probe.textContent).toBe('/invite/abc123');
  });

  it('falls back to home when no address was forwarded', async () => {
    const mounted = await mountSignedInArrival(null);

    expect(requireElement(mounted.container, '[data-testid="probe-home"]').textContent).toBe('/');
  });

  it('refuses a forwarded address that would leave the origin', async () => {
    const mounted = await mountSignedInArrival({ from: 'https://evil.example/phish' });

    expect(requireElement(mounted.container, '[data-testid="probe-home"]').textContent).toBe('/');
  });
});
