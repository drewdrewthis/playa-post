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
  ANSWERED_STATUSES,
  INTRO_DECISION,
  INTRO_REQUEST_STATUS,
  STATUS_FOR_DECISION,
  STATUS_FOR_RESPONSE,
  type IntroRequest,
} from '../domain/intro-request';
import { IntroUnavailableError } from '../domain/intro-request.errors';
import {
  introDecided,
  introRequested,
  introResponded,
  type IntroEvent,
} from '../domain/intro-request.events';
import type {
  IntroDecisionWrite,
  IntroRequestRepository,
  IntroResponseWrite,
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
  id, requester_id, via_id, target_id, note, via_note, status,
  created_at, decided_at, responded_at
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
        //
        // ⚠ `via_note` is written by the same statement and never by a second one. The
        // note and the decision it belongs to are one fact, and `??  null` is what makes
        // "a decline carries no note" true in the column rather than only in the policy
        // that produced the value — the table's `via_note is null or status =
        // 'passed_on'` CHECK is then a backstop with something to check.
        const { rows } = await sql<IntroRequestRow>`
          update app.intro_requests as request
             set status = ${STATUS_FOR_DECISION[write.decision]}::text,
                 via_note = ${write.viaNote ?? null}::text,
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

    async respond(write: IntroResponseWrite): Promise<IntroRequest> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **Every rule about who may answer and in what state lives in this `where`,
        // and there is no eligibility clause beside them** — the one structural difference
        // from `decide` above. A pass-on re-asks the graph because it is about to disclose
        // the requester to somebody; an answer discloses nothing new, because the target
        // has already read the introduction. Re-checking here would let a graph change
        // strand somebody holding an introduction they can neither accept nor refuse.
        //
        // `target_id = <actor>` is what makes "only the target may answer" true — the
        // requester, the via and a stranger each match zero rows, exactly as an id naming
        // nothing does.
        //
        // `status = 'passed_on'` carries three rules at once: an introduction cannot be
        // answered before the via passed it on, cannot be answered twice, and — because a
        // via's `declined` is not this value — cannot be answered at all when the via said
        // no, which is what keeps a target from detecting a decline by trying to accept
        // it. It is also the concurrency control: two simultaneous answers block on the
        // row, and the loser re-evaluates against the committed status and matches
        // nothing.
        //
        // ⚠ `decided_at` is untouched. It is the via's timestamp; the answer gets its own
        // column, so the row keeps both halves of its history and the event below can say
        // when the target actually acted.
        const { rows } = await sql<IntroRequestRow>`
          update app.intro_requests as request
             set status = ${STATUS_FOR_RESPONSE[write.response]}::text,
                 responded_at = ${write.respondedAt}::timestamptz
           where request.id = ${write.introRequestId}::uuid
             and request.target_id = ${write.actorId}::uuid
             and request.status = ${INTRO_REQUEST_STATUS.passedOn}::text
          returning ${INTRO_REQUEST_COLUMNS}
        `.execute(transaction);

        const answered = rows[0];

        if (answered === undefined) {
          // "No such introduction", "not yours to answer", "not passed on", "the via
          // declined it" and "already answered" are one answer, and the throw rolls back
          // so a refused response writes no event.
          throw new IntroUnavailableError();
        }

        const request = toIntroRequest(answered);
        // ⚠ **The acceptance and its event are one transactional fact, and the event is
        // the only thing that makes the connection** (decision D12, ADR-0006).
        // `modules/connections` writes the edge from this row; a connection created by a
        // call from here instead would live in a second transaction, and a failure between
        // the two would leave an introduction that says `accepted`, no connection, and no
        // way to retry — because answering is terminal-once.
        await appendOutboxEvent(transaction, introResponded(request));

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
      //
      // ⚠ **The via's card on a target row is the same inversion, for the same reason**
      // (#175): choosing to pass an introduction on is choosing to be seen by the target
      // as its via. It has to be — the via now has a note of their own on that row, and a
      // vouch nobody can attribute is worse than no vouch. Their own self-projection is
      // what makes that survive the relationship: a via who later severs their connection
      // to the target is still named beside the words they wrote, where the target's own
      // world would have quietly dropped them and left an unsigned note behind.
      const { rows } = await sql<IntroInboxRow>`
        with ${viewerWorld(viewerId)}
        select r.id                              as intro_request_id,
               ${INTRO_INBOX_ROLE.via}::text     as inbox_role,
               r.note                            as note,
               -- Nothing has been passed on yet, so there is no via note to carry — and
               -- the via is the reader, so a card for them could only ever say "you".
               null::text                        as via_note,
               r.created_at                      as created_at,
               requester_person.user_id          as requester_user_id,
               requester_person.disclosure       as requester_disclosure,
               requester_person.display_name     as requester_display_name,
               requester_person.handle           as requester_handle,
               target_person.user_id             as target_user_id,
               target_person.disclosure          as target_disclosure,
               target_person.display_name        as target_display_name,
               target_person.handle              as target_handle,
               null::uuid                        as via_user_id,
               null::text                        as via_disclosure,
               null::text                        as via_display_name,
               null::text                        as via_handle
          from app.intro_requests r
          left join viewer_world requester_person on requester_person.user_id = r.requester_id
          left join viewer_world target_person on target_person.user_id = r.target_id
         where r.via_id = ${viewerId}::uuid
           and r.status = ${INTRO_REQUEST_STATUS.requested}::text
         union all
        select r.id,
               ${INTRO_INBOX_ROLE.target}::text,
               r.note,
               r.via_note,
               r.created_at,
               consenting.user_id,
               consenting.disclosure,
               consenting.display_name,
               consenting.handle,
               -- The target is the reader, so their card could only ever say "you".
               null::uuid,
               null::text,
               null::text,
               null::text,
               vouching.user_id,
               vouching.disclosure,
               vouching.display_name,
               vouching.handle
          from app.intro_requests r
          left join lateral (
            select p.user_id, p.disclosure, p.display_name, p.handle
              from app.visible_people(r.requester_id, 0, 1) p
          ) consenting on true
          left join lateral (
            select p.user_id, p.disclosure, p.display_name, p.handle
              from app.visible_people(r.via_id, 0, 1) p
          ) vouching on true
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
      //
      // ⚠ And it carries no `via_note` either, which is a stronger rule than the first
      // one rather than the same one repeated. The via wrote those words *to the target*,
      // about the requester; showing them here would turn a vouch into something the
      // person being vouched for reads over the writer's shoulder, and no via would write
      // an honest one twice.
      //
      // ⚠ **The status reported is the via's decision, and never the target's answer**
      // (#166). `accepted` and `target_declined` both read back as `passed_on`, so a
      // requester cannot tell a target who refused from one who has not got to it yet.
      // That is the same rule that keeps a via's decline invisible to the target, one
      // person along: somebody who can be seen refusing cannot safely refuse, and an
      // introduction is worth nothing if the person receiving it is under obligation.
      // An acceptance is still learned — it discloses itself, by connecting — which is the
      // target's own act rather than this read's disclosure. `responded_at` is absent here
      // for the same reason, since a timestamp appearing on the row would say it just as
      // loudly as a status would.
      const { rows } = await sql<IntroOutboxRow>`
        with ${viewerWorld(viewerId)}
        select r.id                    as intro_request_id,
               case
                 when r.status in (${sql.join(
                   [...ANSWERED_STATUSES].map((status) => sql`${status}::text`),
                 )})
                 then ${INTRO_REQUEST_STATUS.passedOn}::text
                 else r.status
               end                     as status,
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
      // ⚠ Identifiers and routing data only — **never `note`, and never `via_note`**. A
      // consumer re-reads either through this module's authorized reads if it needs it,
      // which is also what stops a delivery carrying text the current visibility rules
      // have since withdrawn (ADR-0006, PDF §6), and what keeps intro text out of any log
      // line that dumps an outbox row (M2-AC16). `IntroPassedOn` is the event most likely
      // to grow one — a notification consumer would love to quote the vouch — and it is
      // exactly the one that must not.
      //
      // ⚠ **An `IntroDeclined` row names the target and no consumer may tell them**, and
      // an `IntroTargetDeclined` row names the requester and no consumer may tell *them*
      // (#166). In both cases the fact happened and the audit trail is entitled to it;
      // the delivery is what must not exist. The identifiers are here because a consumer
      // routing an `IntroPassedOn` — or forming a connection from an `IntroAccepted` —
      // needs them, and one payload shape for five events beats five that could drift.
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
