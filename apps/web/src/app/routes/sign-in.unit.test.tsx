// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { SessionProvider } from '../auth/session-provider';
import type { AuthClient } from '../auth/supabase-auth-client';
import {
  createFakeApi,
  mountWithApi,
  requireElement,
  setFieldValue,
  type MountedTree,
} from '../testing/mount-with-api';

import { SignInRoute } from './sign-in';

/**
 * Pins the code input's `maxLength`/`pattern` to the 6-to-8-digit window (#199).
 *
 * The width of this input is a *server* fact — production issues 8-digit codes
 * (`mailer_otp_length: 8`) while the local stack defaults to 6 — and a `maxLength`
 * shorter than the emailed code silently truncates every correct entry. The e2e
 * suite exercises the same contract in a browser, but that job is advisory; this
 * is the assertion that lives in branch-protected CI.
 */

/** Anonymous forever: the screen under test is the signed-out one. */
function createAnonymousAuthClient(): AuthClient {
  return {
    currentSession: () => Promise.resolve(null),
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

async function mountCodeForm(): Promise<MountedTree> {
  // SignInRoute talks to the auth client, never the API — an empty fake proves it.
  tree = await mountWithApi(
    <SessionProvider authClient={createAnonymousAuthClient()}>
      <SignInRoute />
    </SessionProvider>,
    createFakeApi({}),
  );

  const email = requireElement<HTMLInputElement>(tree.container, 'input[type="email"]');
  setFieldValue(email, 'reader@example.com');

  await tree.run(() => {
    requireElement<HTMLFormElement>(tree!.container, 'form').requestSubmit();
  });

  return tree;
}

async function mountSignedOut(): Promise<MountedTree> {
  tree = await mountWithApi(
    <SessionProvider authClient={createAnonymousAuthClient()}>
      <SignInRoute />
    </SessionProvider>,
    createFakeApi({}),
  );

  return tree;
}

/**
 * Pins the PWA install hint (#203): the sign-in screen must tell a new user that the
 * app installs to a home screen and how, on every platform. iOS Safari has no install
 * prompt API, so these static instructions are the only universal path — losing them
 * in a refactor would silently strand exactly the users the PWA build exists for.
 */
describe('SignInRoute install hint', () => {
  it('offers the install disclosure, collapsed so the form stays first', async () => {
    const mounted = await mountSignedOut();

    const hint = requireElement<HTMLDetailsElement>(
      mounted.container,
      '[data-testid="pwa-install-hint"]',
    );

    expect(hint.open).toBe(false);
    expect(hint.textContent).toContain('Add The Playa Post to your home screen');
  });

  it('covers all three install paths: iOS Safari, Android Chrome, desktop', async () => {
    const mounted = await mountSignedOut();

    const hint = requireElement<HTMLDetailsElement>(
      mounted.container,
      '[data-testid="pwa-install-hint"]',
    );

    expect(hint.textContent).toContain('Add to Home Screen');
    expect(hint.textContent).toContain('Install app');
    expect(hint.textContent).toContain('address bar');
  });
});

describe('SignInRoute code entry', () => {
  it('accepts codes six to eight digits wide, never capping below what prod sends', async () => {
    const mounted = await mountCodeForm();

    const input = requireElement<HTMLInputElement>(
      mounted.container,
      '[data-testid="sign-in-code-input"]',
    );

    expect(input.maxLength).toBe(8);
    expect(input.pattern).toBe('[0-9]{6,8}');
  });

  it('keeps the copy free of a digit-count promise the server does not make', async () => {
    const mounted = await mountCodeForm();

    expect(mounted.container.textContent).not.toContain('6-digit');
    expect(mounted.container.textContent).not.toContain('8-digit');
  });
});
