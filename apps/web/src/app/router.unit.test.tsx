// @vitest-environment jsdom
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, type RouteObject, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appRoutes } from './router';
import { NOT_FOUND_TITLE, ROUTE_CRASH_TITLE } from './routes/route-error-copy';

/**
 * The wiring test for issue #125.
 *
 * `route-error-log.unit.test.ts` proves the redaction and the copy module holds the
 * words, but neither notices if the `errorElement` or the `*` route is deleted from
 * `router.tsx` — the screens would still be perfectly good screens that nothing
 * renders. So this mounts the exported `appRoutes` themselves: the crash case clones
 * the real root route (keeping its real `errorElement`) and hangs one throwing child
 * off it, and the unknown-address case mounts the tree untouched.
 *
 * The one thing this file does *not* borrow from the app is a route that throws — the
 * tree deliberately contains none.
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and this is
 * the only test in it that renders React.
 */

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

// React 18 gates `act` on this flag; without it every render logs "The current testing
// environment is not configured to support act(...)" over the assertions.
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root | null = null;

async function mount(element: JSX.Element): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);

  mounted = root;
  await act(async () => {
    root.render(element);
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

  vi.restoreAllMocks();
});

/** Throws where a screen would render, which is the failure #125 had nowhere to put. */
function Boom(): JSX.Element {
  throw Object.assign(new Error('render exploded'), { token: 'secret-abc123' });
}

describe('the app’s route tree', () => {
  it('catches a render throw on the root’s error element', async () => {
    // React logs every error it hands to a boundary, and this throw is deliberate, so
    // the log is noise rather than signal. What the *app* logs is a separate contract,
    // proven in `routes/route-error-log.unit.test.ts`.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const [rootRoute] = appRoutes;

    if (rootRoute === undefined || rootRoute.index === true) {
      throw new Error('expected appRoutes to start with the pathless layout route');
    }

    const withCrashingChild: RouteObject[] = [
      {
        ...rootRoute,
        children: [...(rootRoute.children ?? []), { path: '/boom', element: <Boom /> }],
      },
    ];

    const container = await mount(
      <RouterProvider
        router={createMemoryRouter(withCrashingChild, { initialEntries: ['/boom'] })}
      />,
    );

    expect(container.querySelector('[data-testid="route-error"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain(ROUTE_CRASH_TITLE);
    // The screen shows a digest, never the thrown value or anything hung off it.
    expect(container.textContent ?? '').not.toContain('secret-abc123');
    expect(container.querySelector('[data-testid="route-error-reload"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-error-reset"]')).not.toBeNull();
  });

  it('answers an address it does not know with the not-found screen', async () => {
    // The catch-all's own development breadcrumb; see `routes/not-found.tsx`.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = await mount(
      <RouterProvider
        router={createMemoryRouter(appRoutes, { initialEntries: ['/no-such-place'] })}
      />,
    );

    expect(container.querySelector('[data-testid="not-found"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain(NOT_FOUND_TITLE);
    // An unknown address is the product's 404, not a crash.
    expect(container.querySelector('[data-testid="route-error"]')).toBeNull();
  });
});
