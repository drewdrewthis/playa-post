import { describe, expect, it } from 'vitest';

import { dismissEachNotification } from './dismiss-notifications';

/**
 * A fake `dismiss` that records what it was asked to do and how much of it ran at
 * once, and refuses the ids it was told to refuse — the shape a 404
 * `NOTIFICATION_UNAVAILABLE` takes at this seam.
 */
function recordingDismiss(refuse: readonly string[] = []) {
  const attempted: string[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  return {
    attempted,
    peakInFlight: (): number => peakInFlight,
    async dismiss(notificationId: string): Promise<{ notificationId: string }> {
      attempted.push(notificationId);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);

      // Yield, so a caller that fired these concurrently would have all of them in
      // flight here and `peakInFlight` would exceed one.
      await Promise.resolve();
      inFlight -= 1;

      if (refuse.includes(notificationId)) {
        throw new Error('NOTIFICATION_UNAVAILABLE');
      }

      return { notificationId };
    },
  };
}

describe('dismissEachNotification', () => {
  describe('given notifications the server accepts', () => {
    it('dismisses every one of them', async () => {
      const fake = recordingDismiss();

      const outcome = await dismissEachNotification(['n1', 'n2', 'n3'], fake.dismiss);

      expect(fake.attempted).toEqual(['n1', 'n2', 'n3']);
      expect(outcome.dismissed).toEqual(['n1', 'n2', 'n3']);
      expect(outcome.failed).toEqual([]);
    });

    it('runs them one at a time rather than in a burst', async () => {
      const fake = recordingDismiss();

      await dismissEachNotification(['n1', 'n2', 'n3'], fake.dismiss);

      expect(fake.peakInFlight()).toBe(1);
    });
  });

  describe('given the server refuses one of them', () => {
    /*
     * The load-bearing case. A notification that aged out of the retention window
     * answers 404 while its neighbours are perfectly dismissable, so an abort on the
     * first refusal would leave a "CLEAR ALL" that clears nothing after the first
     * stale row.
     */
    it('still attempts the ones after it', async () => {
      const fake = recordingDismiss(['n2']);

      await dismissEachNotification(['n1', 'n2', 'n3'], fake.dismiss);

      expect(fake.attempted).toEqual(['n1', 'n2', 'n3']);
    });

    it('reports the refused one as failed and the rest as dismissed', async () => {
      const fake = recordingDismiss(['n2']);

      const outcome = await dismissEachNotification(['n1', 'n2', 'n3'], fake.dismiss);

      expect(outcome.dismissed).toEqual(['n1', 'n3']);
      expect(outcome.failed).toEqual(['n2']);
    });

    it('does not reject', async () => {
      const fake = recordingDismiss(['n1', 'n2']);

      await expect(
        dismissEachNotification(['n1', 'n2'], fake.dismiss),
      ).resolves.toBeDefined();
    });
  });

  describe('given the server refuses all of them', () => {
    it('reports every one as failed and none as dismissed', async () => {
      const fake = recordingDismiss(['n1', 'n2']);

      const outcome = await dismissEachNotification(['n1', 'n2'], fake.dismiss);

      expect(outcome.dismissed).toEqual([]);
      expect(outcome.failed).toEqual(['n1', 'n2']);
    });
  });

  describe('given nothing to dismiss', () => {
    it('calls the server not at all', async () => {
      const fake = recordingDismiss();

      const outcome = await dismissEachNotification([], fake.dismiss);

      expect(fake.attempted).toEqual([]);
      expect(outcome.dismissed).toEqual([]);
      expect(outcome.failed).toEqual([]);
    });
  });
});
