import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import type { IntroPerson } from '../application/intro-person';
import {
  INTRO_INBOX_ROLE,
  type VisibleIntroInboxRow,
  type VisibleIntroOutboxRow,
} from '../application/visible-intro';
import type { VisibleIntrosRepository } from '../application/visible-intros.repository';
import {
  INTRO_DECISION,
  INTRO_REQUEST_STATUS,
  STATUS_FOR_DECISION,
  type IntroRequest,
} from '../domain/intro-request';
import { IntroUnavailableError } from '../domain/intro-request.errors';
import { introDecided, introRequested, type IntroEvent } from '../domain/intro-request.events';
import type {
  IntroDecisionWrite,
  IntroRequestRepository,
  NewIntroRequest,
} from '../domain/intro-request.repository';

import { toIntroRequest, type IntroRequestRow } from './intro-request.mapper';
import {
  toIntroViaCandidate,
  toVisibleIntroInboxRow,
  toVisibleIntroOutboxRow,
  type IntroInboxRow,
  type IntroOutboxRow,
  type IntroViaCandidateRow,
} from './visible-intro.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresIntroRequestRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The columns every write statement returns.
 *
 * Named columns rather than `select *`, matching
 * `modules/bulletins/persistence/postgres-bulletin.repository.ts`: written once so the
 * insert and the update cannot drift into two shapes for
 * {@link import('./intro-request.mapper').IntroRequestRow} to be right about only one of.
 */
const INTRO_REQUEST_COLUMNS = sql`
  id, requester_id, via_id, target_id, note, status, created_at, decided_at
`;

/**
 * The reader's own §6a-projected world, as a CTE every read joins its person cards from.
 *
 * ⚠ **`app.visible_people` and never `app.users`.** A card assembled from the users table
 * would be the second person-projection ADR-0002 §6a forbids, and no rule in this build
 * could see it — a Kysely `sql` literal is not a `.sql` file, so `sql-table-ownership`
 * never reads these lines.
 *
 * `max_depth` and `node_budget` are left to the function's own defaults, exactly as
 * `app.visible_notes` leaves them: they are operational bounds on the traversal, not a
 * product rule about intros — which is why every join onto this CTE is a LEFT join and
 * no row may depend on it for its own survival.
 */
function viewerWorld(viewerId: string) {
  return sql`
    viewer_world as (
      select vp.user_id, vp.disclosure, vp.display_name, vp.handle
        from app.visible_people(${viewerId}::uuid) vp
    )
  `;
}

/**
 * `app.intro_requests` and `app.intro_via_candidates`, behind both of this module's
 * ports.
 *
 * One object implementing two interfaces, because they describe two *questions* rather
 * than two stores: {@link IntroRequestRepository} is the two gated writes, and
 * {@link VisibleIntrosRepository} is the three role-scoped, §6a-projected reads.
 * Consumers declare whichever they need, so the request service cannot reach a read and
 * the inbox query cannot reach a write.
 *
 * Every statement is schema-qualified (`app.intro_requests`, never `intro_requests`) per
 * ADR-0002's pooler-safety rules: with `search_path` outside this file's control, an
 * unqualified name is a silent cross-schema read waiting for a `public.intro_requests`
 * to exist.
 *
 * ⚠ This file also writes `app.outbox_events`, which is not a layering slip: a state
 * change and its event are **one transactional fact** (addendum §10, ADR-0006), and a
 * port per table would make the atomicity a convention two services have to remember
 * rather than a guarantee the database enforces.
 */
export function createPostgresIntroRequestRepository(
  dependencies: PostgresIntroRequestRepositoryDependencies,
): IntroRequestRepository & VisibleIntrosRepository {
  const { database } = dependencies;

  return {
    async request(write: NewIntroRequest): Promise<IntroRequest> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **The authorization is this statement, not a step before it.** One
        // `INSERT … SELECT … WHERE EXISTS`, so an ineligible triple inserts zero rows and
        // the refusal is decided by the same snapshot as the write — there is no
        // read-then-write window in which a connection could be removed, and no ordering
        // a future editor could rearrange (ADR-0005 precedence rule 1, expressed where it
        // cannot be moved).
        //
        // ⚠ It composes `app.intro_via_candidates`, which composes `app.visible_people`.
        // Reachability has exactly one definition (ADR-0002 §6, ADR-0004:75-77), and an
        // eligibility test written against `app.connections` here would be a second one —
        // reachable only through this write path, where nothing else in the build could
        // see it.
        //
        // ⚠ **`ON CONFLICT … DO NOTHING` is the anti-spam rule, not an optimisation.**
        // The partial unique index allows one open request per (requester, target); a
        // second one must come back as the ordinary refusal rather than as a unique
        // violation escaping the driver as a 500. It is also the concurrency control:
        // two simultaneous requests for one pair block on the index, and the loser
        // inserts nothing rather than racing a `select` that said the pair was free.
        const { rows } = await sql<IntroRequestRow>`
          insert into app.intro_requests (requester_id, via_id, target_id, note, status, created_at)
          select ${write.requesterId}::uuid,
                 ${write.viaId}::uuid,
                 ${write.targetId}::uuid,
                 ${write.note}::text,
                 ${INTRO_REQUEST_STATUS.requested}::text,
                 ${write.createdAt}::timestamptz
           where exists (
                   select 1
                     from app.intro_via_candidates(
                            ${write.requesterId}::uuid,
                            ${write.targetId}::uuid
                          ) candidate
                    where candidate.via_id = ${write.viaId}::uuid
                 )
          on conflict (requester_id, target_id) where status = 'requested' do nothing
          returning ${INTRO_REQUEST_COLUMNS}
        `.execute(transaction);

        const inserted = rows[0];

        if (inserted === undefined) {
          // Zero rows means the `EXISTS` was false or the pair already has an open ask,
          // and this throw rolls the transaction back — so a refused request leaves zero
          // rows in `app.intro_requests` and zero in `app.outbox_events`. One error for
          // every reason: telling "no such person" apart from "not a shared connection"
          // apart from "you already asked" is the oracle ADR-0002 §10 forbids.
          throw new IntroUnavailableError();
        }

        const request = toIntroRequest(inserted);
        await appendOutboxEvent(transaction, introRequested(request));

        return request;
      });
    },

    async decide(write: IntroDecisionWrite): Promise<IntroRequest> {
      // ⚠ **`pass_on` re-checks eligibility; `decline` does not.** A request is not a
      // snapshot of the graph it was made in: if the requester and via, or the via and
      // target, are no longer connected — or the target lowered their reach below the
      // requester, or deactivated — then passing it on would disclose the requester to
      // somebody the current rules say may not reach them. Declining discloses nothing to
      // anybody, so it stays available for as long as the request is open; a via must
      // always be able to say no, and a via who *cannot* say no because the graph moved
      // is a via stuck holding somebody's ask forever.
      //
      // `true` rather than an empty fragment for the decline branch: both branches then
      // compile to a complete boolean expression, so the statement cannot be left
      // syntactically valid but semantically half-built by a later edit.
      //
      // The row being updated is aliased `request` so the correlated call below names its
      // columns explicitly. Unqualified `requester_id` would resolve the same way — the
      // subquery's only range table is `candidate` — but "the same way" is a fact about
      // today's column list rather than something the statement says.
      const eligibility =
        write.decision === INTRO_DECISION.passOn
          ? sql`exists (
                  select 1
                    from app.intro_via_candidates(
                           request.requester_id,
                           request.target_id
                         ) candidate
                   where candidate.via_id = ${write.actorId}::uuid
                )`
          : sql`true`;

      return database.transaction().execute(async (transaction) => {
        // ⚠ Every rule about who may decide and in what state lives in this `where`.
        // `via_id = <actor>` is what makes "only the named via may decide" true — the
        // requester, the target and a third party each match zero rows, exactly as a
        // request that never existed does. `status = 'requested'` is the concurrency
        // control: two simultaneous decides block on the row, the loser re-evaluates
        // against the committed status, matches nothing, and is refused.
        const { rows } = await sql<IntroRequestRow>`
          update app.intro_requests as request
             set status = ${STATUS_FOR_DECISION[write.decision]}::text,
                 decided_at = ${write.decidedAt}::timestamptz
           where request.id = ${write.introRequestId}::uuid
             and request.via_id = ${write.actorId}::uuid
             and request.status = ${INTRO_REQUEST_STATUS.requested}::text
             and ${eligibility}
          returning ${INTRO_REQUEST_COLUMNS}
        `.execute(transaction);

        const updated = rows[0];

        if (updated === undefined) {
          // "No such request", "not yours", "already decided" and "no longer eligible"
          // are one answer, and the throw rolls back so a refused decide writes no event.
          throw new IntroUnavailableError();
        }

        const request = toIntroRequest(updated);
        await appendOutboxEvent(transaction, introDecided(request));

        return request;
      });
    },

    async findViaCandidates(requesterId: string, targetId: string): Promise<readonly IntroPerson[]> {
      // Both identifiers travel as bound parameters, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      //
      // No `order by` here: the function already orders, so a second one would be a
      // second answer to a question that has one (see `intro-via-candidates.sql`).
      const { rows } = await sql<IntroViaCandidateRow>`
        select via_id, disclosure, display_name, handle
          from app.intro_via_candidates(${requesterId}::uuid, ${targetId}::uuid)
      `.execute(database);

      return rows.map(toIntroViaCandidate);
    },

    async findInboxFor(viewerId: string): Promise<readonly VisibleIntroInboxRow[]> {
      // ⚠ **Two branches, and the pairing of role to status in each is the whole
      // authorization.** A via reads `requested` rows addressed to them; a target reads
      // `passed_on` rows addressed to them. There is no third branch and no parameter
      // that could add one — which is what makes a declined request invisible to the
      // target *by construction* rather than by a filter somebody could widen.
      //
      // ⚠ The target's requester card comes from `app.visible_people(requester, 0, 1)` —
      // the requester's own self-projection — and **not** from the target's world. That
      // is the consent inversion stated in SQL: asking for the introduction is the
      // consent, so a requester whose own `visible_to_distance` would hide them from a
      // second-degree stranger is still shown here, at their own `full` self-disclosure.
      // It is still `app.visible_people`, so §6a's "no direct join to app.users for a
      // person card" holds, and a deactivated requester still drops out (ADR-0002 B11).
      const { rows } = await sql<IntroInboxRow>`
        with ${viewerWorld(viewerId)}
        select r.id                              as intro_request_id,
               ${INTRO_INBOX_ROLE.via}::text     as inbox_role,
               r.note                            as note,
               r.created_at                      as created_at,
               requester_person.user_id          as requester_user_id,
               requester_person.disclosure       as requester_disclosure,
               requester_person.display_name     as requester_display_name,
               requester_person.handle           as requester_handle,
               target_person.user_id             as target_user_id,
               target_person.disclosure          as target_disclosure,
               target_person.display_name        as target_display_name,
               target_person.handle              as target_handle
          from app.intro_requests r
          left join viewer_world requester_person on requester_person.user_id = r.requester_id
          left join viewer_world target_person on target_person.user_id = r.target_id
         where r.via_id = ${viewerId}::uuid
           and r.status = ${INTRO_REQUEST_STATUS.requested}::text
         union all
        select r.id,
               ${INTRO_INBOX_ROLE.target}::text,
               r.note,
               r.created_at,
               consenting.user_id,
               consenting.disclosure,
               consenting.display_name,
               consenting.handle,
               -- The target is the reader, so their card could only ever say "you".
               null::uuid,
               null::text,
               null::text,
               null::text
          from app.intro_requests r
          left join lateral (
            select p.user_id, p.disclosure, p.display_name, p.handle
              from app.visible_people(r.requester_id, 0, 1) p
          ) consenting on true
         where r.target_id = ${viewerId}::uuid
           and r.status = ${INTRO_REQUEST_STATUS.passedOn}::text
         order by created_at desc, intro_request_id desc
      `.execute(database);

      return rows.map(toVisibleIntroInboxRow);
    },

    async findOutboxFor(viewerId: string): Promise<readonly VisibleIntroOutboxRow[]> {
      // Every status, unlike the inbox — this is the requester's own record of what they
      // asked. It carries no `note`: they wrote it, and a second copy of it living on a
      // read nothing gates would be the copy `modules/notes` refuses for the same reason.
      const { rows } = await sql<IntroOutboxRow>`
        with ${viewerWorld(viewerId)}
        select r.id                    as intro_request_id,
               r.status                as status,
               r.target_id             as target_id,
               r.created_at            as created_at,
               r.decided_at            as decided_at,
               via_person.user_id      as via_user_id,
               via_person.disclosure   as via_disclosure,
               via_person.display_name as via_display_name,
               via_person.handle       as via_handle
          from app.intro_requests r
          left join viewer_world via_person on via_person.user_id = r.via_id
         where r.requester_id = ${viewerId}::uuid
         order by r.created_at desc, r.id desc
      `.execute(database);

      return rows.map(toVisibleIntroOutboxRow);
    },
  };
}

/**
 * Append one outbox row inside the caller's transaction.
 *
 * A local helper rather than a second port method: the outbox row rides the same
 * transaction as the change it describes, so it has no life of its own to expose.
 * Publishing to a queue from here instead is the dual-write bug — the commit succeeds,
 * the publish fails, and the two diverge with nothing left to reconcile them.
 */
async function appendOutboxEvent(
  transaction: DatabaseConnection,
  event: IntroEvent,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and none was added for
      // this. v4 is a correct key — the ADR guarantees no ordering and consumers must
      // not assume any — and this is the one line that changes when a v7 source arrives.
      event_id: randomUUID(),
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_id: event.actorId,
      aggregate_id: event.introRequestId,
      // ⚠ Identifiers and routing data only — **never `note`**. A consumer re-reads it
      // through this module's authorized reads if it needs it, which is also what stops a
      // delivery carrying text the current visibility rules have since withdrawn
      // (ADR-0006, PDF §6), and what keeps intro text out of any log line that dumps an
      // outbox row (M2-AC16).
      //
      // ⚠ **An `IntroDeclined` row names the target and no consumer may tell them.** The
      // fact happened and the audit trail is entitled to it; the delivery is what must
      // not exist. The identifier is here because a consumer routing an `IntroPassedOn`
      // needs it, and one payload shape for three events beats three that could drift.
      //
      // Passed as an object, not a `JSON.stringify`d string: the generated type for a
      // `jsonb` column is `Json`, so a string type-checks and stores a JSON *scalar*
      // that every consumer would then have to parse twice.
      payload: {
        introRequestId: event.introRequestId,
        requesterId: event.requesterId,
        viaId: event.viaId,
        targetId: event.targetId,
      },
    })
    .execute();
}
