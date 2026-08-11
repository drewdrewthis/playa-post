import { beforeEach, describe, expect, it } from 'vitest';

import {
  deviceLocalPushEnrollmentStore,
  PUSH_PROMPT_DISMISSED_STORAGE_KEY,
  PUSH_SUBSCRIBED_KEY_STORAGE_KEY,
} from './push-enrollment-store';

/**
 * The device-local marker, over a stand-in for Web Storage.
 *
 * The `unit` project runs in a plain Node environment with no `localStorage` global, so
 * this is the same in-memory stand-in `theme-preference.unit.test.ts` builds — a fake at
 * a boundary this repo does not own, not a mock of code it does. This is the one file
 * that swaps the global: everything above the store takes a {@link PushEnrollmentStore}
 * and is tested by handing one in.
 */
class InMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/** A locked-down profile: reading or writing storage throws rather than returning null. */
class ThrowingStorage {
  getItem(): never {
    throw new Error('storage disabled');
  }

  setItem(): never {
    throw new Error('storage disabled');
  }

  removeItem(): never {
    throw new Error('storage disabled');
  }
}

/** An obvious placeholder key: a realistic VAPID key in a test file reads as a credential. */
const PUBLIC_KEY = 'QUJDREVGRw';

describe('the device-local push enrollment marker', () => {
  beforeEach(() => {
    globalThis.localStorage = new InMemoryStorage();
  });

  it('is empty on a device that has never been asked', () => {
    expect(deviceLocalPushEnrollmentStore().read()).toEqual({
      subscribedKey: null,
      dismissedAt: null,
    });
  });

  it('remembers the key this device subscribed under, not merely that it did', () => {
    // The key, because a subscription is bound for life to the one that minted it: after
    // a VAPID rotation, "subscribed" under the old key is not subscribed at all, and a
    // boolean could not tell those two devices apart.
    const store = deviceLocalPushEnrollmentStore();

    store.rememberSubscribed(PUBLIC_KEY);

    expect(store.read().subscribedKey).toBe(PUBLIC_KEY);
  });

  it('forgets an earlier dismissal when the device subscribes', () => {
    // Both facts answer the same question, so a device may never hold both. A leftover
    // "not now" on an enrolled device would silence the offer after a permission revoke,
    // which is the one thing the revoke path must not do.
    const store = deviceLocalPushEnrollmentStore();

    store.rememberPromptDismissed();
    store.rememberSubscribed(PUBLIC_KEY);

    expect(store.read().dismissedAt).toBeNull();
  });

  it('remembers when the prompt was dismissed, as a time the cooldown can be read against', () => {
    const before = Date.now();
    const store = deviceLocalPushEnrollmentStore();

    store.rememberPromptDismissed();

    const { dismissedAt } = store.read();

    expect(dismissedAt).toBeInstanceOf(Date);
    expect(dismissedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(dismissedAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('forgets the subscription without forgetting the dismissal', () => {
    // Two facts, dropped for different reasons: a revoked permission un-enrols a device
    // and says nothing about whether it was ever offered push in the first place.
    globalThis.localStorage.setItem(PUSH_SUBSCRIBED_KEY_STORAGE_KEY, PUBLIC_KEY);
    globalThis.localStorage.setItem(
      PUSH_PROMPT_DISMISSED_STORAGE_KEY,
      new Date('2026-08-01T00:00:00.000Z').toISOString(),
    );

    const store = deviceLocalPushEnrollmentStore();

    store.forgetSubscribed();

    expect(store.read().subscribedKey).toBeNull();
    expect(store.read().dismissedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('ignores a stored timestamp that is not a date', () => {
    // Hand-edited storage, or a format this app used to write. An unparseable stamp is
    // no dismissal at all, which offers push rather than suppressing it forever.
    globalThis.localStorage.setItem(PUSH_PROMPT_DISMISSED_STORAGE_KEY, 'yesterday');

    expect(deviceLocalPushEnrollmentStore().read().dismissedAt).toBeNull();
  });

  it('reads empty and writes nothing when storage is unavailable, rather than throwing', () => {
    // A private-mode or locked-down profile throws on access. The cost of an empty marker
    // is one flash of the consent copy before `settlePushEnrollment` answers; the cost of
    // a throw is the notifications panel.
    globalThis.localStorage = new ThrowingStorage() as unknown as Storage;

    const store = deviceLocalPushEnrollmentStore();

    expect(store.read()).toEqual({ subscribedKey: null, dismissedAt: null });
    expect(() => {
      store.rememberSubscribed(PUBLIC_KEY);
    }).not.toThrow();
    expect(() => {
      store.rememberPromptDismissed();
    }).not.toThrow();
    expect(() => {
      store.forgetSubscribed();
    }).not.toThrow();
  });
});
