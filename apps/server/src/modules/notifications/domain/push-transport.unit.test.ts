import { describe, expect, it } from 'vitest';

import { unconfiguredPushTransport } from '../infrastructure/unconfigured-push.transport';

import { isPushDeliveryConfigured, type PushTransport } from './push-transport';

/**
 * Lane-only coverage for `isPushDeliveryConfigured`'s deliberate fail-safe default —
 * `isConfigured` omitted reads as configured, so a real adapter that forgets to
 * declare the flag still gets scheduled (see `push-transport.ts`'s own warning on the
 * field).
 */
describe('isPushDeliveryConfigured', () => {
  describe('given a transport that declares isConfigured: true', () => {
    it('reads as configured', () => {
      const transport: PushTransport = {
        isConfigured: true,
        send: () => Promise.resolve(),
      };

      expect(isPushDeliveryConfigured(transport)).toBe(true);
    });
  });

  describe('given unconfiguredPushTransport, which declares isConfigured: false', () => {
    it('reads as not configured', () => {
      expect(isPushDeliveryConfigured(unconfiguredPushTransport)).toBe(false);
    });
  });

  describe('given a transport that omits isConfigured entirely', () => {
    it('reads as configured, the deliberate fail-safe default', () => {
      const transport: PushTransport = {
        send: () => Promise.resolve(),
      };

      expect(isPushDeliveryConfigured(transport)).toBe(true);
    });
  });
});
