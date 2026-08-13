import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createDecideConnectionRequestService } from '../../application/decide-connection-request.service';
import { createEnsurePersonalLinkService } from '../../application/ensure-personal-link.service';
import { createListConnectionRequestsQuery } from '../../application/list-connection-requests.query';
import { createOpenPersonalLinkQuery } from '../../application/open-personal-link.query';
import { PERSONAL_LINK_VIEWER_STATE } from '../../application/opened-personal-link';
import { createRotatePersonalLinkService } from '../../application/rotate-personal-link.service';
import { createSendConnectionRequestService } from '../../application/send-connection-request.service';
import { CONNECTION_REQUEST_DECISION } from '../../domain/connection-request';
import { ConnectionRequestUnavailableError } from '../../domain/connection-request.errors';
import {
  CONNECTION_REQUEST_RATE_LIMIT,
  CONNECTION_REQUEST_TTL_DAYS,
  PENDING_CONNECTION_REQUEST_CAP,
} from '../../domain/connection-request.policy';
import { PersonalLinkUnavailableError } from '../../domain/personal-link.errors';
import { createPostgresConnectionRequestRepository } from '../../persistence/postgres-connection-request.repository';
import { createPostgresPersonalLinkRepository } from '../../persistence/postgres-personal-link.repository';

/**
 * The permanent, rotatable personal link, against real Postgres (issue #206, ADR-0018).
 *
 * ⚠ **The load-bearing suite for this feature.** Everything that matters lives in single SQL
 * statements — the gated insert that carries seven refusals, the gated update that carries
 * four, and the transaction that writes the edge — so a unit test over a fake proves the
 * service is thin and proves nothing about the rules. The indistinguishability assertions in
 * particular can only be made here: they serialize several genuinely different situations and
 * assert the set has one element.
 *
 * Seeds through the superuser client (raw SQL), the discipline every integration suite in this
 * module uses: seeding a rotated link or a lapsed request through the port under test would
 * make the fixture circular.
 */
describe('personal connection links (issue #206)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password 'app_rw_in_a_throwaway_container'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(
        testDatabase.connectionString,
        'app_rw',
        'app_rw_in_a_throwaway_container',
      ),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  const NOW = new Date('2026-08-13T12:00:00.000Z');
  const clock = (): Date => NOW;

  function personalLinks() {
    return createPostgresPersonalLinkRepository({ database });
  }

  function connectionRequests() {
    return createPostgresConnectionRequestRepository({ database });
  }

  function ensureService() {
    return createEnsurePersonalLinkService({ personalLinks: personalLinks(), now: clock });
  }

  function rotateService() {
    return createRotatePersonalLinkService({ personalLinks: personalLinks(), now: clock });
  }

  function openQuery() {
    return createOpenPersonalLinkQuery({ links: connectionRequests(), now: clock });
  }

  function sendService() {
    return createSendConnectionRequestService({
      connectionRequests: connectionRequests(),
      now: clock,
    });
  }

  function inboxQuery() {
    return createListConnectionRequestsQuery({ requests: connectionRequests(), now: clock });
  }

  function decideService() {
    return createDecideConnectionRequestService({
      connectionRequests: connectionRequests(),
      now: clock,
    });
  }

  async function seedUser(handle: string, status = 'active'): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, status, created_at)
       values ($1, $2, $3, $4, now()) returning id`,
      [randomUUID(), handle, handle, status],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`seedUser(${handle}): insert returned no row`);
    }
    return id;
  }

  async function seedConnection(oneUserId: string, otherUserId: string): Promise<void> {
    const [a, b] = oneUserId < otherUserId ? [oneUserId, otherUserId] : [otherUserId, oneUserId];
    await testDatabase.client.query(
      `insert into app.connections (user_a_id, user_b_id, status, created_at)
       values ($1, $2, 'accepted', now())`,
      [a, b],
    );
  }

  async function seedRequest(
    ownerId: string,
    requesterId: string,
    createdAt: Date,
    status = 'pending',
  ): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connection_requests (owner_id, requester_id, status, created_at, decided_at)
       values ($1, $2, $3, $4::timestamptz, case when $3::text = 'pending' then null else $4::timestamptz end)`,
      [ownerId, requesterId, status, createdAt],
    );
  }

  async function countRows(table: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select pg_catalog.count(*)::text as count from ${table}`,
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('the link itself', () => {
    it('is minted on first sight and returned unchanged on every arrival after', async () => {
      const owner = await seedUser('dusty_owner');

      const first = await ensureService().ensure({ ownerId: owner });
      const second = await ensureService().ensure({ ownerId: owner });
      const third = await ensureService().ensure({ ownerId: owner });

      expect(second.slug).toBe(first.slug);
      expect(third.slug).toBe(first.slug);
      expect(await countRows('app.personal_links')).toBe(1);
    });

    /*
     * ⚠ **The bug this arrangement could have, asserted directly.** The You screen calls
     * `ensure` on every arrival; if a second call rotated, the screen would show a working
     * link while every copy already shared stopped resolving — silently, with nothing to
     * catch it but somebody complaining that their link died.
     */
    it('never rotates as a side effect of being read', async () => {
      const owner = await seedUser('dusty_stable');
      const first = await ensureService().ensure({ ownerId: owner });

      await ensureService().ensure({ ownerId: owner });

      const { rows } = await testDatabase.client.query<{ slug: string; rotated_at: Date | null }>(
        `select slug, rotated_at from app.personal_links where owner_id = $1`,
        [owner],
      );
      expect(rows[0]?.slug).toBe(first.slug);
      expect(rows[0]?.rotated_at).toBeNull();
    });

    it('is not an encoding of its owner', async () => {
      const owner = await seedUser('dusty_opaque');

      const { slug } = await ensureService().ensure({ ownerId: owner });

      expect(slug).not.toContain(owner);
      expect(slug).not.toContain(Buffer.from(owner).toString('base64url'));
    });
  });

  describe('rotation', () => {
    it('replaces the slug, stamps rotated_at, and leaves created_at alone', async () => {
      const owner = await seedUser('dusty_rotator');
      const before = await ensureService().ensure({ ownerId: owner });

      const after = await rotateService().rotate({ ownerId: owner });

      expect(after.slug).not.toBe(before.slug);
      expect(after.rotatedAt).toEqual(NOW);
      expect(after.createdAt).toEqual(before.createdAt);
      expect(await countRows('app.personal_links')).toBe(1);
    });

    /*
     * ⚠ **The anti-oracle property, end to end.** The retired slug must answer exactly what
     * an invented one answers. Asserted by serializing both refusals into a `Set` and
     * requiring one element — not by comparing two messages, which is a property that holds
     * until somebody improves one of them.
     */
    it('makes the old slug indistinguishable from one that never existed', async () => {
      const owner = await seedUser('dusty_shedder');
      const visitor = await seedUser('dusty_visitor');
      const retired = (await ensureService().ensure({ ownerId: owner })).slug;
      await rotateService().rotate({ ownerId: owner });

      const refusals = new Set<string>();
      for (const slug of [retired, 'aSlugNobodyEverMinted']) {
        try {
          await openQuery().open({ viewerId: visitor, slug });
          throw new Error(`expected ${slug} to be refused`);
        } catch (error) {
          expect(error).toBeInstanceOf(PersonalLinkUnavailableError);
          refusals.add(JSON.stringify(error));
        }
      }

      expect(refusals.size).toBe(1);
    });

    it('mints a link for somebody who never had one, rather than failing', async () => {
      const owner = await seedUser('dusty_first_rotate');

      const link = await rotateService().rotate({ ownerId: owner });

      expect(link.slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(await countRows('app.personal_links')).toBe(1);
    });

    /*
     * ⚠ **The guarantee that makes rotating something a person will actually do.** The copy
     * on the You screen promises it; this is the check that the promise is structural.
     */
    it('touches neither existing connections nor already-received requests', async () => {
      const owner = await seedUser('dusty_keeper');
      const friend = await seedUser('dusty_friend');
      const asker = await seedUser('dusty_asker');
      await ensureService().ensure({ ownerId: owner });
      await seedConnection(owner, friend);
      await seedRequest(owner, asker, NOW);

      await rotateService().rotate({ ownerId: owner });

      expect(await countRows('app.connections')).toBe(1);
      const waiting = await inboxQuery().list({ viewerId: owner });
      expect(waiting).toHaveLength(1);
      expect(waiting[0]?.requester.userId).toBe(asker);
    });
  });

  describe('opening a link', () => {
    it('names the owner to a total stranger — the consent inversion, applied to a published address', async () => {
      const owner = await seedUser('dusty_published');
      const stranger = await seedUser('dusty_stranger');
      const { slug } = await ensureService().ensure({ ownerId: owner });

      const opened = await openQuery().open({ viewerId: stranger, slug });

      expect(opened.owner.userId).toBe(owner);
      expect(opened.owner.disclosure).toBe('full');
      expect(opened.owner.displayName).toBe('dusty_published');
      expect(opened.viewerState).toBe(PERSONAL_LINK_VIEWER_STATE.open);
    });

    it('stops resolving when the owner deactivates, with no extra check to forget', async () => {
      const owner = await seedUser('dusty_gone');
      const stranger = await seedUser('dusty_seeker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      await testDatabase.client.query(`update app.users set status = 'deactivated' where id = $1`, [
        owner,
      ]);

      await expect(openQuery().open({ viewerId: stranger, slug })).rejects.toBeInstanceOf(
        PersonalLinkUnavailableError,
      );
    });

    it('reports `own` to the owner, `connected` to a connection, `requested` after asking', async () => {
      const owner = await seedUser('dusty_states');
      const friend = await seedUser('dusty_states_friend');
      const asker = await seedUser('dusty_states_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      await seedConnection(owner, friend);
      await seedRequest(owner, asker, NOW);

      expect((await openQuery().open({ viewerId: owner, slug })).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.own,
      );
      expect((await openQuery().open({ viewerId: friend, slug })).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.connected,
      );
      expect((await openQuery().open({ viewerId: asker, slug })).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.requested,
      );
    });

    it('reports a lapsed request as `open` again, so the asker is not stuck forever', async () => {
      const owner = await seedUser('dusty_lapse_owner');
      const asker = await seedUser('dusty_lapse_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      await seedRequest(owner, asker, daysBefore(NOW, CONNECTION_REQUEST_TTL_DAYS + 1));

      expect((await openQuery().open({ viewerId: asker, slug })).viewerState).toBe(
        PERSONAL_LINK_VIEWER_STATE.open,
      );
    });
  });

  describe('sending a request', () => {
    it('writes one pending row and one ConnectionRequested event, atomically', async () => {
      const owner = await seedUser('dusty_send_owner');
      const asker = await seedUser('dusty_send_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });

      const request = await sendService().send({ requesterId: asker, slug });

      expect(request.status).toBe('pending');
      expect(request.ownerId).toBe(owner);
      const { rows } = await testDatabase.client.query<{ event_type: string; payload: unknown }>(
        `select event_type, payload from app.outbox_events where aggregate_id = $1`,
        [request.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.event_type).toBe('ConnectionRequested');
      expect(JSON.stringify(rows[0]?.payload)).not.toContain(slug);
    });

    /*
     * ⚠ **The whole anti-oracle claim for the write path, in one assertion.** Seven
     * genuinely different situations, serialized into a `Set` that must hold exactly one
     * element. Two of them are the abuse limits, folded in deliberately: "their inbox is
     * full" is a statement about how busy somebody's link is, told to whoever holds a URL.
     */
    it('answers seven different refusals identically', async () => {
      const owner = await seedUser('dusty_uniform_owner');
      const asker = await seedUser('dusty_uniform_asker');
      const connected = await seedUser('dusty_uniform_connected');
      const capped = await seedUser('dusty_uniform_capped');
      const { slug } = await ensureService().ensure({ ownerId: owner });

      // 1. a slug nobody ever minted, and 2. one that was rotated away from
      const rotatedOwner = await seedUser('dusty_uniform_rotated');
      const retired = (await ensureService().ensure({ ownerId: rotatedOwner })).slug;
      await rotateService().rotate({ ownerId: rotatedOwner });

      // 3. a deactivated owner
      const goneOwner = await seedUser('dusty_uniform_gone');
      const goneSlug = (await ensureService().ensure({ ownerId: goneOwner })).slug;
      await testDatabase.client.query(`update app.users set status = 'deactivated' where id = $1`, [
        goneOwner,
      ]);

      // 5. an already-connected pair
      await seedConnection(owner, connected);

      // 6. a pair with an ask already open
      await seedRequest(owner, asker, NOW);

      // 7. an owner whose pending inbox is at the cap
      const cappedOwnerSlug = (await ensureService().ensure({ ownerId: capped })).slug;
      for (let index = 0; index < PENDING_CONNECTION_REQUEST_CAP; index += 1) {
        await seedRequest(capped, await seedUser(`dusty_filler_${String(index)}`), NOW);
      }
      const cappedAsker = await seedUser('dusty_uniform_capped_asker');

      const attempts: readonly (readonly [string, string])[] = [
        [asker, 'aSlugNobodyEverMinted'],
        [asker, retired],
        [asker, goneSlug],
        // 4. your own link
        [owner, slug],
        [connected, slug],
        [asker, slug],
        [cappedAsker, cappedOwnerSlug],
      ];

      const refusals = new Set<string>();
      for (const [requesterId, attemptedSlug] of attempts) {
        try {
          await sendService().send({ requesterId, slug: attemptedSlug });
          throw new Error(`expected ${requesterId} / ${attemptedSlug} to be refused`);
        } catch (error) {
          expect(error).toBeInstanceOf(PersonalLinkUnavailableError);
          refusals.add(JSON.stringify(error));
        }
      }

      expect(refusals.size).toBe(1);
    });

    it('leaves zero rows behind when it refuses', async () => {
      const owner = await seedUser('dusty_norows_owner');
      const asker = await seedUser('dusty_norows_asker');
      await ensureService().ensure({ ownerId: owner });

      await expect(
        sendService().send({ requesterId: asker, slug: 'nothingHere' }),
      ).rejects.toBeInstanceOf(PersonalLinkUnavailableError);

      expect(await countRows('app.connection_requests')).toBe(0);
      expect(await countRows('app.outbox_events')).toBe(0);
    });

    it('refuses once the link has produced its rate limit inside the window', async () => {
      const owner = await seedUser('dusty_rate_owner');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      // Every status counts toward the window, so these are seeded as decided: a burst that
      // was declined as fast as it arrived still consumed the budget, or declining is how an
      // attacker resets it.
      for (let index = 0; index < CONNECTION_REQUEST_RATE_LIMIT; index += 1) {
        await seedRequest(
          owner,
          await seedUser(`dusty_rate_${String(index)}`),
          new Date(NOW.getTime() - 60_000),
          'declined',
        );
      }
      const asker = await seedUser('dusty_rate_asker');

      await expect(sendService().send({ requesterId: asker, slug })).rejects.toBeInstanceOf(
        PersonalLinkUnavailableError,
      );
    });

    /*
     * ⚠ **The expiry must not be a permanent block, and this is the assertion that says so.**
     * The partial unique index cannot read a clock, so it sees a lapsed pending row exactly
     * as it sees a live one; a plain `do nothing` would leave the pair unable to ask again
     * for the rest of time — the opposite of what a fourteen-day expiry is for. The
     * conflict arm refreshes the lapsed row instead.
     */
    it('lets a pair ask again once their previous request has lapsed', async () => {
      const owner = await seedUser('dusty_free_owner');
      const asker = await seedUser('dusty_free_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      await seedRequest(owner, asker, daysBefore(NOW, CONNECTION_REQUEST_TTL_DAYS + 1));

      const refreshed = await sendService().send({ requesterId: asker, slug });

      expect(refreshed.status).toBe('pending');
      expect(refreshed.createdAt).toEqual(NOW);
      // One row per pair, still: the lapsed row was refreshed rather than joined by a second.
      expect(await countRows('app.connection_requests')).toBe(1);
      // And it is back on the owner's inbox, which the lapsed one was not.
      expect(await inboxQuery().list({ viewerId: owner })).toHaveLength(1);
    });

    it('still refuses a second ask while the first is live', async () => {
      // The other half of the same conflict arm. Without this, the test above would pass for
      // an `on conflict do update` with no `where` at all — which would let anybody refresh
      // their own request to the top of somebody's inbox on a loop.
      const owner = await seedUser('dusty_live_owner');
      const asker = await seedUser('dusty_live_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      await sendService().send({ requesterId: asker, slug });

      await expect(sendService().send({ requesterId: asker, slug })).rejects.toBeInstanceOf(
        PersonalLinkUnavailableError,
      );
      expect(await countRows('app.connection_requests')).toBe(1);
    });
  });

  describe('the owner’s inbox', () => {
    it('lists pending requests newest first, naming each requester at full disclosure', async () => {
      const owner = await seedUser('dusty_inbox_owner');
      const older = await seedUser('dusty_inbox_older');
      const newer = await seedUser('dusty_inbox_newer');
      await seedRequest(owner, older, new Date(NOW.getTime() - 2 * 60_000));
      await seedRequest(owner, newer, new Date(NOW.getTime() - 60_000));

      const rows = await inboxQuery().list({ viewerId: owner });

      expect(rows.map((row) => row.requester.userId)).toEqual([newer, older]);
      expect(rows[0]?.requester.displayName).toBe('dusty_inbox_newer');
    });

    /*
     * ⚠ **The consent inversion.** A requester whose own reach setting would hide them from a
     * stranger is still named here, because asking through somebody's published link is the
     * act of consent. Asserted against a requester who has explicitly narrowed their reach.
     */
    it('names a requester whose own visibility would otherwise hide them', async () => {
      const owner = await seedUser('dusty_inversion_owner');
      const shy = await seedUser('dusty_inversion_shy');
      await testDatabase.client.query(
        `update app.users set visible_to_distance = 'first' where id = $1`,
        [shy],
      );
      await seedRequest(owner, shy, NOW);

      const rows = await inboxQuery().list({ viewerId: owner });

      expect(rows[0]?.requester.displayName).toBe('dusty_inversion_shy');
    });

    it('drops a request whose requester has deactivated, rather than leaving a nameless row', async () => {
      const owner = await seedUser('dusty_drop_owner');
      const gone = await seedUser('dusty_drop_gone');
      await seedRequest(owner, gone, NOW);
      await testDatabase.client.query(`update app.users set status = 'deactivated' where id = $1`, [
        gone,
      ]);

      expect(await inboxQuery().list({ viewerId: owner })).toEqual([]);
    });

    it('shows nothing to anybody else, and hides lapsed and decided rows', async () => {
      const owner = await seedUser('dusty_scope_owner');
      const asker = await seedUser('dusty_scope_asker');
      const stranger = await seedUser('dusty_scope_stranger');
      await seedRequest(owner, asker, NOW);
      await seedRequest(owner, await seedUser('dusty_scope_old'), daysBefore(NOW, 30));
      await seedRequest(owner, await seedUser('dusty_scope_done'), NOW, 'declined');

      expect(await inboxQuery().list({ viewerId: owner })).toHaveLength(1);
      expect(await inboxQuery().list({ viewerId: asker })).toEqual([]);
      expect(await inboxQuery().list({ viewerId: stranger })).toEqual([]);
    });
  });

  describe('deciding a request', () => {
    it('accepting writes the connection in the same transaction, not from an event', async () => {
      const owner = await seedUser('dusty_accept_owner');
      const asker = await seedUser('dusty_accept_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });

      const decided = await decideService().decide({
        connectionRequestId: request.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });

      expect(decided.status).toBe('accepted');
      // ⚠ Asserted **without draining any outbox**. This is the one structural difference
      // from an accepted introduction (ADR-0018 D7): the edge exists the moment the mutation
      // returns, because `app.connections` belongs to this module and there is no boundary
      // to route around.
      expect(await countRows('app.connections')).toBe(1);
      const { rows } = await testDatabase.client.query<{ event_type: string }>(
        `select event_type from app.outbox_events order by occurred_at`,
      );
      expect(rows.map((row) => row.event_type)).toEqual([
        'ConnectionRequested',
        'ConnectionAccepted',
      ]);
    });

    it('accepting connects the pair at an accepted invite’s own disclosure', async () => {
      const owner = await seedUser('dusty_disclose_owner');
      const asker = await seedUser('dusty_disclose_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });

      await decideService().decide({
        connectionRequestId: request.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });

      const { rows } = await testDatabase.client.query<{
        status: string;
        a_discloses_to_b_level: string;
        b_discloses_to_a_level: string;
      }>(`select status, a_discloses_to_b_level, b_discloses_to_a_level from app.connections`);
      expect(rows[0]).toEqual({
        status: 'accepted',
        a_discloses_to_b_level: 'full',
        b_discloses_to_a_level: 'full',
      });
      expect(await countRows('app.connection_trust')).toBe(0);
    });

    it('declining connects nobody and announces nothing to the requester', async () => {
      const owner = await seedUser('dusty_decline_owner');
      const asker = await seedUser('dusty_decline_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });

      const decided = await decideService().decide({
        connectionRequestId: request.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.decline,
      });

      expect(decided.status).toBe('declined');
      expect(await countRows('app.connections')).toBe(0);
      // The event exists — the audit trail is entitled to the fact — and no consumer
      // subscribes to it, which is what makes the *delivery* absent rather than the record.
      const { rows } = await testDatabase.client.query<{ event_type: string }>(
        `select event_type from app.outbox_events order by occurred_at`,
      );
      expect(rows.map((row) => row.event_type)).toEqual([
        'ConnectionRequested',
        'ConnectionRequestDeclined',
      ]);
    });

    /*
     * ⚠ Four different reasons, one answer. "That expired" is the one most likely to be
     * added later as a kindness, and it is the one that would tell an owner about a row they
     * may no longer read.
     */
    it('answers four different refusals identically', async () => {
      const owner = await seedUser('dusty_refuse_owner');
      const asker = await seedUser('dusty_refuse_asker');
      const stranger = await seedUser('dusty_refuse_stranger');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const live = await sendService().send({ requesterId: asker, slug });

      const decidedAlready = await seedUser('dusty_refuse_done');
      await seedRequest(owner, decidedAlready, NOW, 'accepted');
      const { rows: doneRows } = await testDatabase.client.query<{ id: string }>(
        `select id from app.connection_requests where requester_id = $1`,
        [decidedAlready],
      );

      const lapsedAsker = await seedUser('dusty_refuse_lapsed');
      await seedRequest(owner, lapsedAsker, daysBefore(NOW, CONNECTION_REQUEST_TTL_DAYS + 1));
      const { rows: lapsedRows } = await testDatabase.client.query<{ id: string }>(
        `select id from app.connection_requests where requester_id = $1`,
        [lapsedAsker],
      );

      const attempts: readonly (readonly [string, string])[] = [
        // no such request
        [owner, '99999999-9999-4999-8999-999999999999'],
        // not yours to decide
        [stranger, live.id],
        // already decided
        [owner, doneRows[0]?.id ?? ''],
        // lapsed
        [owner, lapsedRows[0]?.id ?? ''],
      ];

      const refusals = new Set<string>();
      for (const [actorId, connectionRequestId] of attempts) {
        try {
          await decideService().decide({
            connectionRequestId,
            actorId,
            decision: CONNECTION_REQUEST_DECISION.accept,
          });
          throw new Error(`expected ${connectionRequestId} to be refused for ${actorId}`);
        } catch (error) {
          expect(error).toBeInstanceOf(ConnectionRequestUnavailableError);
          refusals.add(JSON.stringify(error));
        }
      }

      expect(refusals.size).toBe(1);
    });

    it('is terminal-once: two simultaneous answers leave one winner and one connection', async () => {
      const owner = await seedUser('dusty_race_owner');
      const asker = await seedUser('dusty_race_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });

      const outcomes = await Promise.allSettled([
        decideService().decide({
          connectionRequestId: request.id,
          actorId: owner,
          decision: CONNECTION_REQUEST_DECISION.accept,
        }),
        decideService().decide({
          connectionRequestId: request.id,
          actorId: owner,
          decision: CONNECTION_REQUEST_DECISION.decline,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(await countRows('app.connections')).toBeLessThanOrEqual(1);
    });

    it('accepting a pair who are already connected answers, and announces no second connection', async () => {
      const owner = await seedUser('dusty_dup_owner');
      const asker = await seedUser('dusty_dup_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });
      // They connect by some other route while the request sits pending — an invite, or an
      // introduction. The request is still answerable; there is simply no new fact.
      await seedConnection(owner, asker);

      const decided = await decideService().decide({
        connectionRequestId: request.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });

      expect(decided.status).toBe('accepted');
      expect(await countRows('app.connections')).toBe(1);
      const { rows } = await testDatabase.client.query<{ event_type: string }>(
        `select event_type from app.outbox_events where event_type = 'ConnectionAccepted'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('lets a declined pair ask again through the same link', async () => {
      const owner = await seedUser('dusty_again_owner');
      const asker = await seedUser('dusty_again_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const first = await sendService().send({ requesterId: asker, slug });
      await decideService().decide({
        connectionRequestId: first.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.decline,
      });

      // ⚠ A refusal the requester cannot see must not also be a decision they can never
      // revisit — which is why the open-per-pair index is partial on `pending`.
      const second = await sendService().send({ requesterId: asker, slug });

      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('pending');
    });

    it('is unaffected by a rotation between the ask and the answer', async () => {
      const owner = await seedUser('dusty_rotate_mid_owner');
      const asker = await seedUser('dusty_rotate_mid_asker');
      const { slug } = await ensureService().ensure({ ownerId: owner });
      const request = await sendService().send({ requesterId: asker, slug });

      await rotateService().rotate({ ownerId: owner });

      // Rotation retires an *address*, never the requests it already produced (issue #206).
      const decided = await decideService().decide({
        connectionRequestId: request.id,
        actorId: owner,
        decision: CONNECTION_REQUEST_DECISION.accept,
      });
      expect(decided.status).toBe('accepted');
      expect(await countRows('app.connections')).toBe(1);
    });
  });
});

/** The moment `days` before `from`. Local to this file: nothing else measures in days. */
function daysBefore(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * The same connection string, as a different role.
 *
 * Copied from `invitations.integration.test.ts` rather than imported: that file is a sibling
 * test, not a support module, and a test importing another test's helper couples two suites
 * that are meant to be independently deletable.
 */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
