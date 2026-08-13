import { describe, expect, it } from 'vitest';

import type { Connection } from '../../domain/connection';
import {
  CONNECTION_REQUEST_STATUS,
  type ConnectionRequest,
} from '../../domain/connection-request';
import {
  CONNECTION_REQUEST_DECLINED,
  CONNECTION_REQUESTED,
  connectionRequestDeclined,
  connectionRequested,
} from '../../domain/connection-request.events';
import { connectionAccepted } from '../../domain/connection.events';

/**
 * What a connection-request event carries, and what it must never carry (issue #206).
 *
 * ⚠ **Asserted over `JSON.stringify`, not over a field list.** A test that named the
 * expected keys would pass for a payload that had quietly grown a slug beside them; the
 * serialized form is what actually reaches `app.outbox_events` and every log line that dumps
 * one, so that is what is searched.
 */
const OWNER = '11111111-1111-4111-8111-111111111111';
const REQUESTER = '22222222-2222-4222-8222-222222222222';
const SLUG = 'aVerySecretSlug1234567';

function pendingRequest(): ConnectionRequest {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    ownerId: OWNER,
    requesterId: REQUESTER,
    status: CONNECTION_REQUEST_STATUS.pending,
    createdAt: new Date('2026-08-13T12:00:00.000Z'),
  };
}

function declinedRequest(): ConnectionRequest {
  return {
    ...pendingRequest(),
    status: CONNECTION_REQUEST_STATUS.declined,
    decidedAt: new Date('2026-08-13T13:00:00.000Z'),
  };
}

describe('connection-request events (issue #206)', () => {
  describe('connectionRequested', () => {
    it('names both parties and stamps the moment the row was written', () => {
      const event = connectionRequested(pendingRequest());

      expect(event.type).toBe(CONNECTION_REQUESTED);
      expect(event.connectionRequestId).toBe(pendingRequest().id);
      expect(event.ownerId).toBe(OWNER);
      expect(event.requesterId).toBe(REQUESTER);
      expect(event.occurredAt).toEqual(pendingRequest().createdAt);
    });

    it('records the requester as the actor — they are who made this happen', () => {
      expect(connectionRequested(pendingRequest()).actorId).toBe(REQUESTER);
    });

    /*
     * ⚠ **The slug must never travel.** It is a published address the owner may rotate away
     * from, and an event carrying it would keep the retired value alive in the outbox and in
     * every log line that dumps a row — long after the rotation that was supposed to end it.
     * Nothing routes on a slug: a delivery needs to know *who*, and both parties are here.
     */
    it('carries no slug anywhere in its serialized form', () => {
      const serialized = JSON.stringify(connectionRequested(pendingRequest()));

      expect(serialized).not.toContain(SLUG);
      expect(serialized.toLowerCase()).not.toContain('slug');
    });
  });

  describe('connectionRequestDeclined', () => {
    it('stamps the owner’s decision time, not the request’s creation time', () => {
      const event = connectionRequestDeclined(declinedRequest());

      expect(event.type).toBe(CONNECTION_REQUEST_DECLINED);
      expect(event.occurredAt).toEqual(declinedRequest().decidedAt);
    });

    it('records the owner as the actor — the requester did not decline themselves', () => {
      expect(connectionRequestDeclined(declinedRequest()).actorId).toBe(OWNER);
    });

    /*
     * The event exists and its *delivery* must not. Both parties are on it because an audit
     * trail is entitled to them; the rule that no consumer may route this to the requester
     * lives in the type's own docstring and in the fact that no consumer subscribes.
     */
    it('names both parties, because the audit trail is entitled to the fact', () => {
      const event = connectionRequestDeclined(declinedRequest());

      expect(event.ownerId).toBe(OWNER);
      expect(event.requesterId).toBe(REQUESTER);
    });

    it('refuses a row that carries no decision', () => {
      expect(() => connectionRequestDeclined(pendingRequest())).toThrow(/no decision/);
    });

    /*
     * ⚠ Not "declined, else throw" — an *accepted* row reaching this builder must throw
     * rather than be announced as a decline. It is unreachable through the gated update,
     * which routes accepts down the other branch, but the shape that made it reachable is
     * one edit away and the throw costs nothing.
     */
    it('refuses an accepted row rather than announcing it as a decline', () => {
      const accepted: ConnectionRequest = {
        ...declinedRequest(),
        status: CONNECTION_REQUEST_STATUS.accepted,
      };

      expect(() => connectionRequestDeclined(accepted)).toThrow(/not a decline/);
    });
  });

  describe('ConnectionAccepted, with a personal-link origin (ADR-0018 D7)', () => {
    const connection: Connection = {
      id: '44444444-4444-4444-8444-444444444444',
      userAId: OWNER,
      userBId: REQUESTER,
      status: 'accepted',
      aDisclosesToBLevel: 'full',
      bDisclosesToALevel: 'full',
      createdAt: new Date('2026-08-13T13:00:00.000Z'),
    };

    /*
     * The third arm of `ConnectionOrigin`. One event type for every origin is the rule
     * ADR-0012 set — "these two are now connected" is one fact whoever caused it — so what
     * this asserts is that the new origin rides that same type rather than inventing a
     * second one every future consumer would have to remember to subscribe to.
     */
    it('carries connectionRequestId and neither of the other two origins', () => {
      const event = connectionAccepted(connection, {
        actorId: OWNER,
        origin: { connectionRequestId: pendingRequest().id },
      });

      expect(event.connectionRequestId).toBe(pendingRequest().id);
      expect(event.invitationId).toBeUndefined();
      expect(event.introRequestId).toBeUndefined();
    });

    it('omits the other origins entirely rather than serializing them as null', () => {
      // `exactOptionalPropertyTypes` is what keeps the union honest in the type system; this
      // is the runtime half. A payload carrying `"invitationId": null` beside a real
      // `connectionRequestId` would say a connection had two origins.
      const serialized = JSON.stringify(
        connectionAccepted(connection, {
          actorId: OWNER,
          origin: { connectionRequestId: pendingRequest().id },
        }),
      );

      expect(serialized).not.toContain('invitationId');
      expect(serialized).not.toContain('introRequestId');
    });
  });
});
