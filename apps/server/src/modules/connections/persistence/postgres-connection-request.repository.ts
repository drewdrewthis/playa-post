import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection, type RawBuilder } from '@playa-post/database';

import type { OpenedPersonalLinkFacts } from '../application/opened-personal-link';
import type { VisibleConnectionRequest } from '../application/visible-connection-request';
import type { VisibleConnectionRequestsRepository } from '../application/visible-connection-requests.repository';
import { CONNECTION_STATUS, orderedPair } from '../domain/connection';
import {
  CONNECTION_REQUEST_DECISION,
  CONNECTION_REQUEST_STATUS,
  STATUS_FOR_CONNECTION_REQUEST_DECISION,
  type ConnectionRequest,
} from '../domain/connection-request';
import { ConnectionRequestUnavailableError } from '../domain/connection-request.errors';
import {
  connectionRequested,
  connectionRequestDeclined,
  type ConnectionRequestEventUnion,
} from '../domain/connection-request.events';
import {
  CONNECTION_REQUEST_RATE_LIMIT,
  PENDING_CONNECTION_REQUEST_CAP,
} from '../domain/connection-request.policy';
import type {
  ConnectionRequestDecisionWrite,
  ConnectionRequestRepository,
  NewConnectionRequest,
} from '../domain/connection-request.repository';
import { connectionAccepted } from '../domain/connection.events';
import { PersonalLinkUnavailableError } from '../domain/personal-link.errors';

import { toConnectionRequest, type ConnectionRequestRow } from './connection-request.mapper';
import { toConnection } from './connection.mapper';
import {
  toOpenedPersonalLinkFacts,
  toVisibleConnectionRequest,
  type ConnectionRequestInboxRow,
  type PersonalLinkFactsRow,
} from './visible-connection-request.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresConnectionRequestRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The columns every write statement returns.
 *
 * Named columns rather than `select *`, matching this module's other repositories: written
 * once so the insert and the update cannot drift into two shapes for
 * {@link import('./connection-request.mapper').ConnectionRequestRow} to be right about only
 * one of.
 */
const CONNECTION_REQUEST_COLUMNS = sql`id, owner_id, requester_id, status, created_at, decided_at`;

/**
 * One person's own self-projection, as a lateral every read joins its card from.
 *
 * ⚠ **`app.visible_people` and never `app.users`.** A card assembled from the users table
 * would be the second person-projection ADR-0002 §6a forbids, and no rule in this build
 * could see it — a Kysely `sql` literal is not a `.sql` file, so `sql-table-ownership` never
 * reads these lines.
 *
 * ⚠ **The projection is computed for the person themselves, not for the reader**, which is
 * ADR-0017 D4's consent inversion applied to a published address (ADR-0018 D1). At degree 0
 * the function always answers `full`, so an owner is named to a stranger holding their link
 * and a requester is named to the owner they asked — each because of an act they performed,
 * and each still through the one canonical projection. It also carries the person lifecycle
 * for free: a deactivated person yields **no row**, which is why every use of this below is
 * an *inner* join (ADR-0002 B11).
 */
function selfProjection(userIdColumn: string): RawBuilder<unknown> {
  return sql`
    select person.user_id, person.disclosure, person.display_name, person.handle
      from app.visible_people(${sql.ref(userIdColumn)}, 0, 1) person
  `;
}

/**
 * `app.personal_links` and `app.connection_requests`, behind both of this module's new
 * ports (issue #206).
 *
 * One object implementing two interfaces, because they describe two *questions* rather than
 * two stores: {@link ConnectionRequestRepository} is the two gated writes, and
 * {@link VisibleConnectionRequestsRepository} is the two §6a-projected reads. Consumers
 * declare whichever they need, so the send service cannot reach a read and the inbox query
 * cannot reach a write.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules: with `search_path`
 * outside this file's control, an unqualified name is a silent cross-schema read waiting for
 * a `public.connection_requests` to exist.
 *
 * ⚠ This file also writes `app.connections` and `app.outbox_events`, which is not a layering
 * slip on either count. Both tables belong to **this** module — that is precisely the
 * difference from `modules/intros`, which had to route connection creation through an event
 * because `app.connections` was somebody else's (decision D12) — and a state change and its
 * event are one transactional fact (addendum §10, ADR-0006), so a port per table would make
 * the atomicity a convention two services have to remember rather than a guarantee the
 * database enforces.
 */
export function createPostgresConnectionRequestRepository(
  dependencies: PostgresConnectionRequestRepositoryDependencies,
): ConnectionRequestRepository & VisibleConnectionRequestsRepository {
  const { database } = dependencies;

  return {
    async send(write: NewConnectionRequest): Promise<ConnectionRequest> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **Every rule about who may ask, and every limit, is this one statement.** An
        // `INSERT … SELECT … WHERE`, so a refusal inserts zero rows and the refusal is
        // decided by the same snapshot as the write — there is no read-then-write window in
        // which the link could rotate, the pair could connect, or the cap could fill, and
        // no ordering a future editor could rearrange into a different answer.
        //
        // Reading the clauses in order:
        //
        //  - `link.slug = …` resolves the address. A rotated slug matches nothing, because
        //    rotation overwrote the value rather than retiring it (ADR-0018 D3).
        //  - `link.owner_id <> requester` refuses your own link. It is here rather than in
        //    the service so that "that is me" cannot be answered differently from "no such
        //    link" — unlike an invite, a *published* address makes "you minted this" a fact
        //    a stranger could also assert by guessing.
        //  - the `exists (… self projection …)` is the owner's lifecycle: a deactivated,
        //    suspended or erased owner has no projection, so their link stops resolving with
        //    no separate status check to forget (ADR-0002 B11).
        //  - the `not exists (… app.connections …)` refuses a pair who already know each
        //    other, in both storage orders, because the application writes a canonical pair
        //    but fixtures and pre-canonical rows may be either way round.
        //  - the two `count(*)` clauses are the pending cap and the rate window. Both count
        //    rows for the OWNER rather than for the requester: the thing being protected is
        //    somebody's inbox, and a per-requester limit is trivially defeated by a second
        //    account.
        //
        // ⚠ **`ON CONFLICT … DO UPDATE … WHERE lapsed` is the one-open-request-per-pair rule
        // *and* the thing that keeps the TTL from becoming a permanent block.** A second ask
        // while the first is live must come back as the ordinary refusal rather than as a
        // unique violation escaping the driver as a 500 — the `WHERE` is false, no row is
        // updated, and nothing is returned. But a *lapsed* pending row is not a live ask: it
        // is a request the rules already treat as gone, and `DO NOTHING` there would leave
        // the pair unable to ask again for the rest of time, because the partial index sees
        // a lapsed row as pending exactly like a fresh one. Refreshing `created_at` is what
        // "they asked again" means when the row can only exist once per pair.
        //
        // It is also the concurrency control: two simultaneous taps block on the index, and
        // the loser re-evaluates the `WHERE` against the committed row — which is now fresh
        // — matches nothing, and is refused.
        //
        // The conflict target's `where status = 'pending'` is a **literal**, matching the
        // partial index's own predicate: PostgreSQL infers the index by comparing the
        // predicate expressions, and a bound parameter is not the same expression. The
        // `DO UPDATE`'s own `where` names the *existing* row as `connection_requests`, which
        // is the default alias for the insert target.
        const { rows } = await sql<ConnectionRequestRow>`
          insert into app.connection_requests (owner_id, requester_id, status, created_at)
          select link.owner_id,
                 ${write.requesterId}::uuid,
                 ${CONNECTION_REQUEST_STATUS.pending}::text,
                 ${write.createdAt}::timestamptz
            from app.personal_links link
           where link.slug = ${write.slug}::text
             and link.owner_id <> ${write.requesterId}::uuid
             and exists (${selfProjection('link.owner_id')})
             and not exists (
                   select 1
                     from app.connections edge
                    where edge.status = ${CONNECTION_STATUS.accepted}::text
                      and (
                            (edge.user_a_id = link.owner_id
                             and edge.user_b_id = ${write.requesterId}::uuid)
                         or (edge.user_a_id = ${write.requesterId}::uuid
                             and edge.user_b_id = link.owner_id)
                          )
                 )
             and (
                   select pg_catalog.count(*)
                     from app.connection_requests waiting
                    where waiting.owner_id = link.owner_id
                      and waiting.status = ${CONNECTION_REQUEST_STATUS.pending}::text
                      and waiting.created_at > ${write.liveSince}::timestamptz
                 ) < ${PENDING_CONNECTION_REQUEST_CAP}::bigint
             and (
                   select pg_catalog.count(*)
                     from app.connection_requests recent
                    where recent.owner_id = link.owner_id
                      and recent.created_at > ${write.rateWindowSince}::timestamptz
                 ) < ${CONNECTION_REQUEST_RATE_LIMIT}::bigint
          on conflict (owner_id, requester_id) where status = 'pending'
          do update set created_at = excluded.created_at
             where connection_requests.created_at <= ${write.liveSince}::timestamptz
          returning ${CONNECTION_REQUEST_COLUMNS}
        `.execute(transaction);

        const inserted = rows[0];

        if (inserted === undefined) {
          // Zero rows means one of seven things and the caller is told none of them, which
          // is the whole point (ADR-0002 §10). This throw also rolls the transaction back,
          // so a refused request leaves zero rows in `app.connection_requests` and zero in
          // `app.outbox_events`.
          throw new PersonalLinkUnavailableError();
        }

        const request = toConnectionRequest(inserted);
        await appendOutboxEvent(transaction, toOutboxRow(connectionRequested(request)));

        return request;
      });
    },

    async decide(write: ConnectionRequestDecisionWrite): Promise<ConnectionRequest> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ Every rule about who may decide and in what state lives in this `where`.
        // `owner_id = <actor>` is what makes "only the owner may decide" true — the
        // requester and a stranger each match zero rows, exactly as an id naming nothing
        // does. `status = 'pending'` is the terminal-once rule and the concurrency control:
        // two simultaneous decisions block on the row, the loser re-evaluates against the
        // committed status, matches nothing, and is refused. `created_at > liveSince` is the
        // TTL, applied here rather than in a prior check so a request cannot lapse between
        // the check and the write.
        const { rows } = await sql<ConnectionRequestRow>`
          update app.connection_requests as request
             set status = ${STATUS_FOR_CONNECTION_REQUEST_DECISION[write.decision]}::text,
                 decided_at = ${write.decidedAt}::timestamptz
           where request.id = ${write.connectionRequestId}::uuid
             and request.owner_id = ${write.actorId}::uuid
             and request.status = ${CONNECTION_REQUEST_STATUS.pending}::text
             and request.created_at > ${write.liveSince}::timestamptz
          returning ${CONNECTION_REQUEST_COLUMNS}
        `.execute(transaction);

        const updated = rows[0];

        if (updated === undefined) {
          // "No such request", "not yours", "already decided" and "lapsed" are one answer,
          // and the throw rolls back so a refused decision writes no connection and no
          // event.
          throw new ConnectionRequestUnavailableError();
        }

        const request = toConnectionRequest(updated);

        if (write.decision === CONNECTION_REQUEST_DECISION.decline) {
          // ⚠ The event exists and its **delivery must not**. A requester who could tell a
          // decline from a request nobody has answered would make declining unsafe for the
          // owner (ADR-0017's founding invariant, one relationship along). The audit trail
          // is entitled to the fact; no consumer may route it to the requester.
          await appendOutboxEvent(transaction, toOutboxRow(connectionRequestDeclined(request)));

          return request;
        }

        await connectAcceptedPair(transaction, request);

        return request;
      });
    },

    async findLinkBySlugFor(
      viewerId: string,
      slug: string,
      liveSince: Date,
    ): Promise<OpenedPersonalLinkFacts | null> {
      // ⚠ **An INNER join onto the owner's own self-projection.** A left join would answer
      // "the link is real but its owner cannot be described", which is both a person card
      // this system may not render and a disclosure about a deactivated account. Inner, the
      // three failures — no such slug, a rotated slug, an owner who is gone — collapse into
      // zero rows, and the caller turns all three into one `PERSONAL_LINK_UNAVAILABLE`.
      //
      // ⚠ Both `exists` clauses are facts about the **reader** and nothing else: whether
      // they are already connected, and whether they personally have a live request open.
      // Neither counts anybody else's requests, so this read cannot report how busy an
      // owner's link is (ADR-0018 D1).
      const { rows } = await sql<PersonalLinkFactsRow>`
        select owner_person.user_id      as owner_user_id,
               owner_person.disclosure   as owner_disclosure,
               owner_person.display_name as owner_display_name,
               owner_person.handle       as owner_handle,
               exists (
                 select 1
                   from app.connections edge
                  where edge.status = ${CONNECTION_STATUS.accepted}::text
                    and (
                          (edge.user_a_id = link.owner_id and edge.user_b_id = ${viewerId}::uuid)
                       or (edge.user_a_id = ${viewerId}::uuid and edge.user_b_id = link.owner_id)
                        )
               )                         as connected,
               exists (
                 select 1
                   from app.connection_requests waiting
                  where waiting.owner_id = link.owner_id
                    and waiting.requester_id = ${viewerId}::uuid
                    and waiting.status = ${CONNECTION_REQUEST_STATUS.pending}::text
                    and waiting.created_at > ${liveSince}::timestamptz
               )                         as request_pending
          from app.personal_links link
          join lateral (${selfProjection('link.owner_id')}) owner_person on true
         where link.slug = ${slug}::text
      `.execute(database);

      const row = rows[0];

      return row === undefined ? null : toOpenedPersonalLinkFacts(row);
    },

    async findInboxFor(
      viewerId: string,
      liveSince: Date,
    ): Promise<readonly VisibleConnectionRequest[]> {
      // ⚠ **`owner_id = <viewer>` is the whole authorization**, and there is no parameter
      // that could widen it — one inbox per caller, and it is theirs (ADR-0002 §5a). The
      // status and TTL clauses are the same two the decide path applies, so a row that is
      // listed is a row that can still be answered.
      //
      // ⚠ The requester's card is an INNER join onto their own self-projection, so somebody
      // who has since deactivated takes their whole row out of this list rather than leaving
      // a nameless Accept button behind. It is self-healing: reactivating puts the row back,
      // if it has not lapsed meanwhile.
      const { rows } = await sql<ConnectionRequestInboxRow>`
        select request.id                as id,
               request.created_at        as created_at,
               requester.user_id         as requester_user_id,
               requester.disclosure      as requester_disclosure,
               requester.display_name    as requester_display_name,
               requester.handle          as requester_handle
          from app.connection_requests request
          join lateral (${selfProjection('request.requester_id')}) requester on true
         where request.owner_id = ${viewerId}::uuid
           and request.status = ${CONNECTION_REQUEST_STATUS.pending}::text
           and request.created_at > ${liveSince}::timestamptz
         order by request.created_at desc, request.id desc
      `.execute(database);

      return rows.map(toVisibleConnectionRequest);
    },
  };
}

/**
 * Write the edge an accepted request earned, inside the caller's transaction.
 *
 * ⚠ **The third way a connection comes into existence**, after
 * `ConnectionRepository.acceptInvitation` and `createConnectIntroducedPairHandler`. Unlike
 * the second it is synchronous, and the difference is a module boundary rather than a change
 * of heart about ADR-0006: `modules/intros` had to publish an event because `app.connections`
 * belongs to somebody else, and here it does not. One transaction is strictly better when it
 * is available — the owner's Accept returns a connection that already exists, instead of one
 * the drainer will form on its next round.
 *
 * ⚠ The disclosure levels are left to the columns' own defaults, which is exactly what an
 * accepted invite and an accepted introduction get. A connection that disclosed differently
 * depending on how it formed would be a second connection model nobody chose.
 */
async function connectAcceptedPair(
  transaction: DatabaseConnection,
  request: ConnectionRequest,
): Promise<void> {
  const [userAId, userBId] = orderedPair(request.ownerId, request.requesterId);

  // `decidedAt` is guaranteed present — the gated update set it, and the table's
  // `(status = 'pending') = (decided_at is null)` CHECK will not store a decided row
  // without one. A silent fallback here would stamp the edge with the wrong instant in
  // exactly the case that guarantee ever broke, so fail loudly instead.
  if (request.decidedAt === undefined) {
    throw new Error('connectAcceptedPair given a request with no decidedAt');
  }

  const inserted = await transaction
    .insertInto('app.connections')
    .values({
      user_a_id: userAId,
      user_b_id: userBId,
      status: CONNECTION_STATUS.accepted,
      // The moment the owner accepted, so the edge and the request agree about when this
      // happened.
      created_at: request.decidedAt,
    })
    // These two may already be connected — through an invite or an introduction that landed
    // while the request sat pending. The request is still answered, and the acceptance still
    // stands; there is simply no new fact, so nothing is announced. `do nothing` says that
    // in one statement instead of a read-then-write race.
    .onConflict((onConflict) => onConflict.columns(['user_a_id', 'user_b_id']).doNothing())
    .returningAll()
    .executeTakeFirst();

  if (inserted === undefined) {
    // ⚠ But only if the existing row really is an accepted connection. The pair key spans
    // every status and the column carries no CHECK, so an unrecognised status is reachable —
    // and treating one as "already connected" would answer the owner's Accept with a success
    // that connected nobody. Fail closed instead, exactly as `acceptInvitation` does: the
    // throw rolls the whole transaction back, so the request stays pending and answerable.
    const existing = await transaction
      .selectFrom('app.connections')
      .select('status')
      .where('user_a_id', '=', userAId)
      .where('user_b_id', '=', userBId)
      .where('status', '=', CONNECTION_STATUS.accepted)
      .executeTakeFirst();

    if (existing === undefined) {
      throw new Error(
        `connection request ${request.id}: pair row exists but is not an accepted connection`,
      );
    }

    return;
  }

  const connection = toConnection(inserted);
  const accepted = connectionAccepted(connection, {
    // The owner accepted. They are the actor here, the way the invitee is on an accepted
    // invite: whoever performed the act that made the fact.
    actorId: request.ownerId,
    origin: { connectionRequestId: request.id },
  });

  await appendOutboxEvent(transaction, {
    type: accepted.type,
    occurredAt: accepted.occurredAt,
    actorId: accepted.actorId,
    aggregateId: accepted.connectionId,
    payload: {
      connectionId: accepted.connectionId,
      // From the request rather than off the event: `ConnectionAccepted.connectionRequestId`
      // is one arm of a union and is absent on the other two origins, so reading it here
      // would type as `string | undefined` and could serialize a payload with no origin at
      // all. On this path there is always exactly one request, and it is right here.
      connectionRequestId: request.id,
      userAId: accepted.userAId,
      userBId: accepted.userBId,
    },
  });
}

/** The shape every outbox row this file writes is built from. */
interface OutboxRow {
  readonly type: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, string>>;
}

/**
 * Flatten a connection-request event into an outbox row.
 *
 * ⚠ **The payload is the two parties and nothing else — never the slug.** A personal link is
 * a published address the owner may rotate away from, and an event carrying it would keep a
 * retired address alive in every log line that dumps an outbox row, long after the rotation
 * that was supposed to end it. Nothing routes on a slug: a delivery needs to know *who*, and
 * both parties are already here.
 *
 * One shape for both event types rather than two that could drift — the same call
 * `modules/intros` makes across its five.
 */
function toOutboxRow(event: ConnectionRequestEventUnion): OutboxRow {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    aggregateId: event.connectionRequestId,
    payload: { ownerId: event.ownerId, requesterId: event.requesterId },
  };
}

/**
 * Append one outbox row inside the caller's transaction.
 *
 * A local helper rather than a port method: the outbox row rides the same transaction as the
 * change it describes, so it has no life of its own to expose. Publishing to a queue from
 * here instead is the dual-write bug — the commit succeeds, the publish fails, and the two
 * diverge with nothing left to reconcile them.
 *
 * **Identifiers and routing data only** (ADR-0006, PDF §6). A consumer re-reads what it needs
 * through this module's authorized path, which is what stops a delivery carrying data the
 * current visibility rules have since withdrawn.
 */
async function appendOutboxEvent(
  transaction: DatabaseConnection,
  row: OutboxRow,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and none was added for this.
      // v4 is a correct key — the ADR guarantees no ordering and consumers must not assume
      // any — and this is one of the lines that changes when a v7 source arrives.
      event_id: randomUUID(),
      event_type: row.type,
      occurred_at: row.occurredAt,
      actor_id: row.actorId,
      aggregate_id: row.aggregateId,
      // Passed as an object, not a `JSON.stringify`d string: the generated type for a `jsonb`
      // column is `Json`, so a string type-checks and stores a JSON *scalar* that every
      // consumer would then have to parse twice.
      payload: { ...row.payload },
    })
    .execute();
}
