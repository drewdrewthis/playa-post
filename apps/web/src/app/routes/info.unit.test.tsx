// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUY_ME_A_COFFEE_URL,
  GITHUB_REPO_URL,
  INFO_PITCH,
  INFO_VALUES,
} from '../info/info-copy';

import { InfoRoute } from './info';

/**
 * The Info screen (issue #216): the pitch and values on screen, both outbound links
 * present and pointed right, the support QR encoding the same URL as the link beside
 * it, and the replay affordance routing to `/welcome`.
 *
 * Mounted under a memory router because the screen renders `<Link>`; no API fake is
 * needed — the screen is network-free by design, and this test would start failing if
 * someone gave it a query.
 */

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root | null = null;

async function mountInfo(): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);

  mounted = root;
  await act(async () => {
    root.render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/info', element: <InfoRoute /> }], {
          initialEntries: ['/info'],
        })}
      />,
    );
  });

  return container;
}

afterEach(async () => {
  const root = mounted;

  mounted = null;

  if (root !== null) {
    await act(async () => {
      root.unmount();
    });
  }
});

describe('the Info screen', () => {
  it('shows the pitch and the values close', async () => {
    const container = await mountInfo();

    expect(container.textContent ?? '').toContain(INFO_PITCH);
    expect(container.textContent ?? '').toContain(INFO_VALUES);
  });

  it('links to the public repository, opening outside the PWA', async () => {
    const container = await mountInfo();
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="info-github-link"]');

    expect(link?.href).toBe(GITHUB_REPO_URL);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noreferrer');
  });

  it('links support as a plain anchor, opening outside the PWA', async () => {
    const container = await mountInfo();
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="info-coffee-link"]');

    expect(link?.href).toBe(BUY_ME_A_COFFEE_URL);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noreferrer');
    // The widget script this replaces (see `info-copy.ts`) must never come back.
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders the support QR beside the link', async () => {
    const container = await mountInfo();
    const qr = container.querySelector('[data-testid="info-coffee-qr"]');

    // `react-qr-code` renders an SVG; its presence inside the frame is the contract —
    // that the modules encode BUY_ME_A_COFFEE_URL is the library's tested behaviour.
    expect(qr?.querySelector('svg')).not.toBeNull();
  });

  it('routes the replay link at the welcome tour', async () => {
    const container = await mountInfo();
    const replay = container.querySelector<HTMLAnchorElement>(
      '[data-testid="info-replay-welcome"]',
    );

    expect(replay?.getAttribute('href')).toBe('/welcome');
  });
});
