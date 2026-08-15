// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AddChooser } from './add-chooser';

/**
 * The plus button's chooser (issue #221): two options, each explained, each landing
 * on the right screen — and the compose test id living on the board option now, so
 * the affordance the e2e suite presses is the one that opens the form.
 *
 * Mounted under a memory router because choosing navigates; no API fake — the
 * chooser is network-free by design.
 */

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root | null = null;

/** Where the router currently stands, readable from outside the tree. */
let lastPathname = '/';

function LocationProbe(): null {
  lastPathname = useLocation().pathname;
  return null;
}

async function mountChooser(onClose: Mock): Promise<HTMLElement> {
  const container = document.createElement('div');

  document.body.append(container);

  const root = createRoot(container);
  const screen = (
    <>
      <LocationProbe />
      <AddChooser onClose={onClose} />
    </>
  );

  mounted = root;
  await act(async () => {
    root.render(
      <RouterProvider
        router={createMemoryRouter(
          [
            { path: '/', element: screen },
            { path: '/you', element: <LocationProbe /> },
            { path: '/board/new', element: <LocationProbe /> },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );
  });

  return container;
}

afterEach(async () => {
  const root = mounted;

  mounted = null;
  lastPathname = '/';

  if (root !== null) {
    await act(async () => {
      root.unmount();
    });
  }

  document.body.replaceChildren();
});

function pressByTestId(container: HTMLElement, testId: string): Promise<void> {
  return act(async () => {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

    if (button === null) {
      throw new Error(`expected the tree to contain [data-testid="${testId}"]`);
    }

    button.click();
  });
}

describe('AddChooser', () => {
  it('explains each option above its button, in the owner’s two framings', async () => {
    const container = await mountChooser(vi.fn());

    const options = [...container.querySelectorAll('.add-chooser__option')];
    expect(options.length).toBe(2);

    // DOM order pinned: network first, board second — and each explainer precedes
    // its button inside the option, which is what "a little explainer above each
    // button" means structurally.
    const [network, board] = options;
    expect(network?.textContent).toContain(
      'Grow your circle — share your personal link with someone you trust.',
    );
    expect(network?.querySelector('[data-testid="add-network-button"]')?.textContent).toBe(
      'Add someone to your network',
    );
    expect(board?.textContent).toContain(
      'Offer something, ask for something, or announce a gathering.',
    );
    expect(board?.querySelector('[data-testid="compose-bulletin-button"]')?.textContent).toBe(
      'Add something to the board',
    );

    for (const option of options) {
      const children = [...(option?.children ?? [])];
      expect(children[0]?.className).toContain('add-chooser__explainer');
      expect(children[1]?.tagName).toBe('BUTTON');
    }
  });

  it('the network option closes the chooser and lands on the You screen', async () => {
    const onClose = vi.fn();
    const container = await mountChooser(onClose);

    await pressByTestId(container, 'add-network-button');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lastPathname).toBe('/you');
  });

  it('the board option closes the chooser and opens the compose form', async () => {
    const onClose = vi.fn();
    const container = await mountChooser(onClose);

    await pressByTestId(container, 'compose-bulletin-button');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lastPathname).toBe('/board/new');
  });

  it('Close, Escape, and the scrim all leave without navigating', async () => {
    const onClose = vi.fn();
    const container = await mountChooser(onClose);

    await pressByTestId(container, 'add-chooser-close-button');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    await act(async () => {
      container.querySelector<HTMLElement>('.add-chooser__scrim')?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(lastPathname).toBe('/');
  });

  it('takes focus on open, so Escape lands on its own handler', async () => {
    const container = await mountChooser(vi.fn());

    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="add-chooser"]'),
    );
  });
});
