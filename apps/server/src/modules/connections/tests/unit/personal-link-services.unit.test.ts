import { describe, expect, it } from 'vitest';

import { createDecideConnectionRequestService } from '../../application/decide-connection-request.service';
import { createEnsurePersonalLinkService } from '../../application/ensure-personal-link.service';
import { createListConnectionRequestsQuery } from '../../application/list-connection-requests.query';
import { createOpenPersonalLinkQuery } from '../../application/open-personal-link.query';
import type { OpenedPersonalLinkFacts } from '../../application/opened-personal-link';
import { createRotatePersonalLinkService } from '../../application/rotate-personal-link.service';
import { createSendConnectionRequestService } from '../../application/send-connection-request.service';
import type { VisibleConnectionRequest } from '../../application/visible-connection-request';
import type { VisibleConnectionRequestsRepository } from '../../application/visible-connection-requests.repository';
import {
  CONNECTION_REQUEST_DECISION,
  CONNECTION_REQUEST_STATUS,
  type ConnectionRequest,
} from '../../domain/connection-request';
import {
  liveRequestFloor,
  rateWindowFloor,
} from '../../domain/connection-request.policy';
import type {
  ConnectionRequestDecisionWrite,
  ConnectionRequestRepository,
  NewConnectionRequest,
} from '../../domain/connection-request.repository';
import { PersonalLinkUnavailableError } from '../../domain/personal-link.errors';
import type {
  PersonalLinkRepository,
  PersonalLinkWrite,
} from '../../domain/personal-link.repository';

/**
 * The six personal-link use cases, over **fakes rather than mocks** (issue #206).
 *
 * Each fake is an in-memory implementation of a port this module owns, and every assertion
 * is about what the service *emitted* — the write it handed down, the error it raised —
 * rather than about a call sequence. What is being pinned here is the thin-service
 * contract: these files hold no authorization and no limit logic, so the only things worth
 * testing are the clock they read, the values they derive from it, and the one refusal they
 * translate.
 */
const OWNER = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-13T12:00:00.000Z');

function fixedClock(): Date {
  return NOW;
}

/** An in-memory {@link PersonalLinkRepository} that records what it was handed. */
function fakePersonalLinks(): PersonalLinkRepository & {
  readonly ensured: PersonalLinkWrite[];
  readonly rotated: PersonalLinkWrite[];
} {
  const ensured: PersonalLinkWrite[] = [];
  const rotated: PersonalLinkWrite[] = [];

  return {
    ensured,
    rotated,
    async ensureFor(write) {
      ensured.push(write);
      return { ownerId: write.ownerId, slug: write.slug, createdAt: write.at };
    },
    async rotateFor(write) {
      rotated.push(write);
      return {
        ownerId: write.ownerId,
        slug: write.slug,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        rotatedAt: write.at,
      };
    },
  };
}

/** An in-memory {@link ConnectionRequestRepository} that records what it was handed. */
function fakeConnectionRequests(): ConnectionRequestRepository & {
  readonly sent: NewConnectionRequest[];
  readonly decided: ConnectionRequestDecisionWrite[];
} {
  const sent: NewConnectionRequest[] = [];
  const decided: ConnectionRequestDecisionWrite[] = [];

  return {
    sent,
    decided,
    async send(write) {
      sent.push(write);
      return {
        id: 'request-1',
        ownerId: OWNER,
        requesterId: write.requesterId,
        status: CONNECTION_REQUEST_STATUS.pending,
        createdAt: write.createdAt,
      } satisfies ConnectionRequest;
    },
    async decide(write) {
      decided.push(write);
      return {
        id: write.connectionRequestId,
        ownerId: write.actorId,
        requesterId: VIEWER,
        status: CONNECTION_REQUEST_STATUS.accepted,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        decidedAt: write.decidedAt,
      } satisfies ConnectionRequest;
    },
  };
}

/** An in-memory {@link VisibleConnectionRequestsRepository} over a fixed answer. */
function fakeReads(options: {
  readonly link?: OpenedPersonalLinkFacts | null;
  readonly inbox?: readonly VisibleConnectionRequest[];
}): VisibleConnectionRequestsRepository & { readonly floors: Date[] } {
  const floors: Date[] = [];

  return {
    floors,
    async findLinkBySlugFor(_viewerId, _slug, liveSince) {
      floors.push(liveSince);
      return options.link ?? null;
    },
    async findInboxFor(_viewerId, liveSince) {
      floors.push(liveSince);
      return options.inbox ?? [];
    },
  };
}

describe('personal-link use cases (issue #206)', () => {
  describe('ensure', () => {
    it('hands the repository a freshly generated slug and the clock’s moment', async () => {
      const links = fakePersonalLinks();
      const service = createEnsurePersonalLinkService({ personalLinks: links, now: fixedClock });

      const link = await service.ensure({ ownerId: OWNER });

      expect(links.ensured).toHaveLength(1);
      expect(links.ensured[0]?.ownerId).toBe(OWNER);
      expect(links.ensured[0]?.at).toEqual(NOW);
      expect(link.slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    /*
     * ⚠ **A slug is drawn on every call and discarded on all but the first**, and the
     * discarding is the repository's job. The service must not learn to skip the draw by
     * reading first — that read is exactly the race that would let a page load overwrite
     * somebody's published address. Asserted as "two calls, two draws".
     */
    it('generates a slug on every call, leaving idempotence to the database', async () => {
      const links = fakePersonalLinks();
      const service = createEnsurePersonalLinkService({ personalLinks: links, now: fixedClock });

      await service.ensure({ ownerId: OWNER });
      await service.ensure({ ownerId: OWNER });

      expect(links.ensured).toHaveLength(2);
      expect(links.ensured[0]?.slug).not.toBe(links.ensured[1]?.slug);
    });
  });

  describe('rotate', () => {
    it('mints a new slug and stamps the rotation moment', async () => {
      const links = fakePersonalLinks();
      const service = createRotatePersonalLinkService({ personalLinks: links, now: fixedClock });

      const link = await service.rotate({ ownerId: OWNER });

      expect(links.rotated).toHaveLength(1);
      expect(links.rotated[0]?.at).toEqual(NOW);
      expect(link.rotatedAt).toEqual(NOW);
    });

    it('never reads the slug it is replacing — the new one cannot be derived from the old', async () => {
      // The port takes no previous slug, so this is a shape assertion rather than a
      // behavioural one: a rotation that could see the old value is a rotation somebody
      // could make recognisable to whoever held it.
      const links = fakePersonalLinks();
      const service = createRotatePersonalLinkService({ personalLinks: links, now: fixedClock });

      await service.rotate({ ownerId: OWNER });

      expect(Object.keys(links.rotated[0] ?? {}).sort()).toEqual(['at', 'ownerId', 'slug']);
    });
  });

  describe('open', () => {
    it('collapses the repository’s null into the one neutral refusal', async () => {
      const query = createOpenPersonalLinkQuery({ links: fakeReads({ link: null }), now: fixedClock });

      await expect(query.open({ viewerId: VIEWER, slug: 'nope' })).rejects.toBeInstanceOf(
        PersonalLinkUnavailableError,
      );
    });

    it('passes the TTL floor down, so a lapsed request is not reported as pending', async () => {
      const reads = fakeReads({
        link: {
          owner: { userId: OWNER, disclosure: 'full', displayName: 'Dusty' },
          connected: false,
          requestPending: false,
        },
      });
      const query = createOpenPersonalLinkQuery({ links: reads, now: fixedClock });

      await query.open({ viewerId: VIEWER, slug: 'live' });

      expect(reads.floors).toEqual([liveRequestFloor(NOW)]);
    });
  });

  describe('listInbox', () => {
    it('passes the same TTL floor the decide path uses', async () => {
      // ⚠ The two surfaces have to agree: a row that is listed must be a row that can still
      // be answered, or the owner is shown a button the server refuses.
      const reads = fakeReads({ inbox: [] });
      const query = createListConnectionRequestsQuery({ requests: reads, now: fixedClock });

      await query.list({ viewerId: OWNER });

      expect(reads.floors).toEqual([liveRequestFloor(NOW)]);
    });
  });

  describe('send', () => {
    /*
     * ⚠ **One clock reading, used for three things.** Reading per floor would make a
     * request that arrived on a boundary count itself, or not, depending on which
     * microsecond each read landed in — a flake that would only ever show up under load.
     */
    it('derives both floors from the same instant it stamps the row with', async () => {
      const requests = fakeConnectionRequests();
      const service = createSendConnectionRequestService({
        connectionRequests: requests,
        now: fixedClock,
      });

      await service.send({ requesterId: VIEWER, slug: 'abc' });

      expect(requests.sent[0]).toEqual({
        requesterId: VIEWER,
        slug: 'abc',
        createdAt: NOW,
        liveSince: liveRequestFloor(NOW),
        rateWindowSince: rateWindowFloor(NOW),
      });
    });

    it('holds no authorization of its own — it passes the slug down untouched', async () => {
      // The slug is not trimmed, lowercased, or validated here. Every one of those would be
      // a second opinion about what a live link is, and the gated insert is the first.
      const requests = fakeConnectionRequests();
      const service = createSendConnectionRequestService({
        connectionRequests: requests,
        now: fixedClock,
      });

      await service.send({ requesterId: VIEWER, slug: '  MiXeD-Case  ' });

      expect(requests.sent[0]?.slug).toBe('  MiXeD-Case  ');
    });
  });

  describe('decide', () => {
    it('passes the actor, the decision, and one clock reading used for both fields', async () => {
      const requests = fakeConnectionRequests();
      const service = createDecideConnectionRequestService({
        connectionRequests: requests,
        now: fixedClock,
      });

      await service.decide({
        connectionRequestId: 'request-1',
        actorId: OWNER,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });

      expect(requests.decided[0]).toEqual({
        connectionRequestId: 'request-1',
        actorId: OWNER,
        decision: CONNECTION_REQUEST_DECISION.accept,
        decidedAt: NOW,
        liveSince: liveRequestFloor(NOW),
      });
    });

    /*
     * ⚠ **The service does not branch on the decision, and must not start.** The two
     * decisions differ in one place — whether the transaction also writes `app.connections`
     * — and that difference belongs inside the statement that enforces it. Asserted by
     * sending a decline and checking the write is identical but for the one field.
     */
    it('sends a decline down exactly the same path as an accept', async () => {
      const requests = fakeConnectionRequests();
      const service = createDecideConnectionRequestService({
        connectionRequests: requests,
        now: fixedClock,
      });

      await service.decide({
        connectionRequestId: 'request-1',
        actorId: OWNER,
        decision: CONNECTION_REQUEST_DECISION.decline,
      });

      expect(requests.decided[0]).toEqual({
        connectionRequestId: 'request-1',
        actorId: OWNER,
        decision: CONNECTION_REQUEST_DECISION.decline,
        decidedAt: NOW,
        liveSince: liveRequestFloor(NOW),
      });
    });
  });
});
