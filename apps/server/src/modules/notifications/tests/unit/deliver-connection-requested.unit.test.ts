import { describe, expect, it } from 'vitest';

import type { RecordConnectionRequestNotificationCommand } from '../../application/connection-request-notification.repository';
import {
  createDeliverConnectionRequestedHandler,
  DELIVER_CONNECTION_REQUESTED_CONSUMER,
} from '../../application/deliver-connection-requested.handler';
import type { OutboxEventRow } from '../../application/outbox-consumer';
import type { NotificationKind } from '../../domain/notification-kind';
import type { NotificationOptoutRepository } from '../../domain/notification-optout.repository';

/**
 * The `ConnectionRequested` consumer's three decisions (issue #218), proven against
 * fakes: an event it does not subscribe to leaves no trace, an opted-out owner gets no
 * receipt, and everyone else gets exactly the receipt — because the receipt *is* the
 * notification (ADR-0006). SQL correctness is the integration suites' job.
 */
describe('deliver connection requested (issue #218)', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const processedAt = new Date('2026-08-15T12:00:00.000Z');

  function event(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
    return {
      eventId: 'event-1',
      eventType: 'ConnectionRequested',
      occurredAt: new Date('2026-08-15T11:59:00.000Z'),
      actorId: null,
      aggregateId: 'request-1',
      payload: { ownerId, requesterId: '00000000-0000-4000-8000-000000000002' },
      ...overrides,
    };
  }

  /** Records every receipt written, so the assertions read emitted values. */
  function fakeReceipts(): {
    written: RecordConnectionRequestNotificationCommand[];
    recordConnectionRequestNotification: (
      command: RecordConnectionRequestNotificationCommand,
    ) => Promise<void>;
  } {
    const written: RecordConnectionRequestNotificationCommand[] = [];
    return {
      written,
      recordConnectionRequestNotification: async (command) => {
        written.push(command);
      },
    };
  }

  function fakeOptouts(optedOutKinds: readonly NotificationKind[] = []): NotificationOptoutRepository {
    return {
      hasOptedOut: async (owner, kind) => owner === ownerId && optedOutKinds.includes(kind),
      findOptedOutKinds: async () => new Set(optedOutKinds),
      optOut: async () => undefined,
      optIn: async () => undefined,
    };
  }

  it('names itself with the stable receipt literal', () => {
    expect(DELIVER_CONNECTION_REQUESTED_CONSUMER).toBe('DeliverConnectionRequestedHandler');
  });

  it('writes the receipt for a ConnectionRequested event — delivery is the default', async () => {
    const receipts = fakeReceipts();
    const handler = createDeliverConnectionRequestedHandler({
      connectionRequestNotifications: receipts,
      optouts: fakeOptouts(),
      now: () => processedAt,
    });

    await handler.handle(event());

    expect(receipts.written).toEqual([{ eventId: 'event-1', processedAt }]);
  });

  it('returns without a receipt for an event type it does not subscribe to', async () => {
    const receipts = fakeReceipts();
    const handler = createDeliverConnectionRequestedHandler({
      connectionRequestNotifications: receipts,
      optouts: fakeOptouts(),
    });

    await handler.handle(event({ eventType: 'NotePinned' }));

    expect(receipts.written).toHaveLength(0);
  });

  it('writes no receipt for an owner opted out of the connections kind', async () => {
    const receipts = fakeReceipts();
    const handler = createDeliverConnectionRequestedHandler({
      connectionRequestNotifications: receipts,
      optouts: fakeOptouts(['connections']),
    });

    await handler.handle(event());

    expect(receipts.written).toHaveLength(0);
  });

  it('still delivers to an owner opted out of a DIFFERENT kind — the switch is per kind', async () => {
    const receipts = fakeReceipts();
    const handler = createDeliverConnectionRequestedHandler({
      connectionRequestNotifications: receipts,
      optouts: fakeOptouts(['note', 'bulletins']),
      now: () => processedAt,
    });

    await handler.handle(event());

    expect(receipts.written).toEqual([{ eventId: 'event-1', processedAt }]);
  });
});
