// @vitest-environment jsdom
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  setFieldValue,
  type MountedTree,
} from '../testing/mount-with-api';

import { OnboardingRoute } from './onboarding';

/**
 * Pins onboarding's exit (#205): completing the form resumes the address that was
 * interrupted for it, when `RequireSession` forwarded one, and home otherwise. This is
 * the last hop of the deep-link round trip — the first two live in
 * `auth/deep-link-return.unit.test.tsx`.
 */

function LocationProbe({ label }: { readonly label: string }): JSX.Element {
  return <p data-testid={`probe-${label}`}>{useLocation().pathname}</p>;
}

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

async function completeOnboarding(state: unknown): Promise<MountedTree> {
  tree = await mountWithApi(
    <MemoryRouter initialEntries={[{ pathname: '/onboarding', state }]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingRoute />} />
        <Route path="/" element={<LocationProbe label="home" />} />
        <Route path="/invite/:token" element={<LocationProbe label="invite" />} />
      </Routes>
    </MemoryRouter>,
    createFakeApi({
      'identity.completeOnboarding': () => ({}),
    }),
  );

  setFieldValue(
    requireElement(tree.container, '[data-testid="onboarding-handle-input"]'),
    'dusty_reader',
  );
  setFieldValue(
    requireElement(tree.container, '[data-testid="onboarding-display-name-input"]'),
    'Dusty Reader',
  );

  await tree.run(() => {
    requireElement<HTMLFormElement>(tree!.container, 'form').requestSubmit();
  });

  return tree;
}

describe('OnboardingRoute completion', () => {
  it('resumes the interrupted address when one was forwarded', async () => {
    const mounted = await completeOnboarding({ from: '/invite/abc123' });

    const probe = requireElement(mounted.container, '[data-testid="probe-invite"]');
    expect(probe.textContent).toBe('/invite/abc123');
  });

  it('lands on home when nothing was forwarded', async () => {
    const mounted = await completeOnboarding(null);

    expect(requireElement(mounted.container, '[data-testid="probe-home"]').textContent).toBe('/');
  });
});
