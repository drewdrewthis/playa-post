import type { RegisterSWOptions } from 'virtual:pwa-register';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `virtual:pwa-register` exists only through `vite-plugin-pwa`'s own build/dev pipeline —
 * Vitest never runs that resolver, so there is no real module here to reach with a fake.
 * This is the boundary case `../offline/sync-runner.unit.test.ts` describes: a mock, not a
 * fake, because nothing real sits at the boundary to fake.
 *
 * `vi.hoisted` keeps `registerSW` one stable instance across the file. `vi.mock`'s factory
 * is re-invoked on every `resetModules()` below, but it always closes over this same
 * instance rather than minting a new one, so each test's `.mock.calls` history reflects
 * only that test once `afterEach` has cleared it.
 */
const { registerSW } = vi.hoisted(() => ({
  registerSW: vi.fn<(options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>>(),
}));

vi.mock('virtual:pwa-register', () => ({ registerSW }));

const HOUR_MS = 60 * 60 * 1000;

/** Reads the handler the module registered, failing loudly if it never wired one up. */
function registeredOnRegisteredSW(): NonNullable<RegisterSWOptions['onRegisteredSW']> {
  const onRegisteredSW = registerSW.mock.calls[0]?.[0]?.onRegisteredSW;

  if (onRegisteredSW === undefined) {
    throw new Error('registerSW was not called with an onRegisteredSW handler');
  }

  return onRegisteredSW;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  registerSW.mockClear();
});

/**
 * The module has no exports — registering is its only job, done as a side effect at import
 * time — so each test re-imports it fresh to trigger that side effect again.
 */
describe('register-service-worker', () => {
  it('registers immediately, not waiting for the tab to navigate first', async () => {
    await import('./register-service-worker');

    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
  });

  it('polls a registration for updates once an hour, for as long as the tab stays open', async () => {
    await import('./register-service-worker');

    const update = vi.fn();
    const registration = { update } as unknown as ServiceWorkerRegistration;

    registeredOnRegisteredSW()('/sw.js', registration);

    expect(update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('tolerates a registration the browser did not hand back', async () => {
    await import('./register-service-worker');

    expect(() => registeredOnRegisteredSW()('/sw.js', undefined)).not.toThrow();

    // `advanceTimersByTimeAsync` resolves to its own chainable `vi`, not `undefined` — assert
    // only that flushing the interval settled rather than rejected, which is what
    // `registration?.update()` guards against when `registration` is undefined.
    let settled = false;

    await vi.advanceTimersByTimeAsync(HOUR_MS).then(() => {
      settled = true;
    });

    expect(settled).toBe(true);
  });
});
