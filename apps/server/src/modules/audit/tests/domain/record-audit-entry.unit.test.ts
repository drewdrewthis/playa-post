import { describe, expect, it } from 'vitest';

// Neither of these exists yet — legible failure at this seam until the coder writes
// them. `OutboxEventRecord` is the entrypoint's envelope shape (owned by
// `entrypoints/outbox-drainer/`, imported here as a type only — no persistence, no
// cross-module boundary violation); `toAuditEntry` is the pure mapping this module
// owns.
import type { OutboxEventRecord } from '../../../../entrypoints/outbox-drainer/outbox-event';
import { toAuditEntry } from '../../domain/record-audit-entry';

/**
 * `RecordAuditEntryHandler`'s pure mapping step (plan M2.15, ADR-0002 Q4).
 *
 * No I/O here — this is the unit-level half of the "internal IDs only, no bulletin
 * content, no contact data" contract. `record-audit-entry-handler.integration.test.ts`
 * covers the transactional write and idempotency; this file covers the shape of what
 * gets written, independent of Postgres.
 */
describe('toAuditEntry (audit domain, ADR-0002 Q4)', () => {
  function sourceEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
    return {
      eventId: 'a1111111-1111-4111-8111-111111111111',
      eventType: 'ConnectionAccepted',
      occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      actorId: 'b2222222-2222-4222-8222-222222222222',
      aggregateId: 'c3333333-3333-4333-8333-333333333333',
      attempts: 1,
      payload: {},
      ...overrides,
    };
  }

  describe('given an ordinary event', () => {
    it('copies event_type, occurred_at, actor_id, and aggregate_id from the envelope', () => {
      const event = sourceEvent();

      const entry = toAuditEntry(event);

      expect(entry).toMatchObject({
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        aggregateId: event.aggregateId,
      });
    });

    it('records the source event id, not a freshly-minted one, so an entry traces back to what produced it', () => {
      const event = sourceEvent();

      const entry = toAuditEntry(event);

      expect(entry.sourceEventId).toBe(event.eventId);
    });
  });

  describe('given an event whose actor is null (a system-originated event)', () => {
    it('carries actor_id through as null rather than coercing it', () => {
      const event = sourceEvent({ actorId: null });

      const entry = toAuditEntry(event);

      expect(entry.actorId).toBeNull();
    });
  });

  describe('given a payload that carries content or contact data — the negative assertion', () => {
    it('never copies any payload field into the audit entry, whatever the payload contains', () => {
      const event = sourceEvent({
        payload: {
          headline: 'Need a ride to Center Camp tonight',
          body: 'Meet me at the trash fence at 9pm',
          authorDisplayName: 'Dusty Rhodes',
          contactEmail: 'dusty@example.com',
          contactPhone: '+1-555-0100',
        },
      });

      const entry = toAuditEntry(event);

      // Allow-listed keys only. Anything from `payload` — content or contact —
      // has no field to land in, which is the point: the mapping cannot leak what
      // it never reads.
      expect(Object.keys(entry).sort()).toEqual(
        ['eventType', 'occurredAt', 'actorId', 'aggregateId', 'sourceEventId'].sort(),
      );

      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('Center Camp');
      expect(serialized).not.toContain('dusty@example.com');
      expect(serialized).not.toContain('+1-555-0100');
      expect(serialized).not.toContain('Dusty Rhodes');
    });
  });
});
