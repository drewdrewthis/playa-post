import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { AcceptInviteService } from '../application/accept-invite.service';
import type { CreateInviteService } from '../application/create-invite.service';
import type { DecideConnectionRequestService } from '../application/decide-connection-request.service';
import type { EnsurePersonalLinkService } from '../application/ensure-personal-link.service';
import type { GetConnectionQuery } from '../application/get-connection.query';
import type { ListConnectionRequestsQuery } from '../application/list-connection-requests.query';
import type { OpenInviteService } from '../application/open-invite.service';
import type { OpenPersonalLinkQuery } from '../application/open-personal-link.query';
import type { RotatePersonalLinkService } from '../application/rotate-personal-link.service';
import type { SendConnectionRequestService } from '../application/send-connection-request.service';
import type { SetConnectionTrustService } from '../application/set-connection-trust.service';
import { ConnectionRequestUnavailableError } from '../domain/connection-request.errors';
import { NotConnectedError } from '../domain/connection.errors';
import {
  CannotAcceptOwnInviteError,
  InvitationUnavailableError,
} from '../domain/invitation.errors';
import { PersonalLinkUnavailableError } from '../domain/personal-link.errors';

import { presentConnection, type PresentedConnection } from './connection.presenter';
import {
  decideConnectionRequestCommandFields,
  decideConnectionRequestInput,
} from './decide-connection-request.input';
import { getConnectionInput } from './get-connection.input';
import {
  presentInvite,
  presentOpenedInvite,
  type PresentedInvite,
  type PresentedOpenedInvite,
} from './invitation.presenter';
import { inviteTokenInput } from './invite-token.input';
import { personalLinkSlugInput } from './personal-link-slug.input';
import {
  presentConnectionRequest,
  presentIncomingConnectionRequest,
  presentOpenedPersonalLink,
  presentPersonalLink,
  type PresentedConnectionRequest,
  type PresentedIncomingConnectionRequest,
  type PresentedOpenedPersonalLink,
  type PresentedPersonalLink,
} from './personal-link.presenter';
import { setConnectionTrustInput } from './set-connection-trust.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface ConnectionsRouterDependencies {
  readonly createInvite: CreateInviteService;
  readonly openInvite: OpenInviteService;
  readonly acceptInvite: AcceptInviteService;
  readonly setConnectionTrust: SetConnectionTrustService;
  readonly getConnection: GetConnectionQuery;
  readonly ensurePersonalLink: EnsurePersonalLinkService;
  readonly rotatePersonalLink: RotatePersonalLinkService;
  readonly openPersonalLink: OpenPersonalLinkQuery;
  readonly sendConnectionRequest: SendConnectionRequestService;
  readonly listConnectionRequests: ListConnectionRequestsQuery;
  readonly decideConnectionRequest: DecideConnectionRequestService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for a spent invite. The stable application code
 * travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`INVITATION_UNAVAILABLE` and `NOT_CONNECTED` are both `NOT_FOUND`, and that is the
 * security-relevant choice.** A `FORBIDDEN` on either would confirm that the thing
 * exists and belongs to somebody else — an invite token that was once real, or a
 * connection between two other people. `NOT_FOUND` is the same answer the caller would
 * get for something that never existed, which is what ADR-0002 §10 asks for and what
 * B10's indistinguishability row measures.
 *
 * `CANNOT_ACCEPT_OWN_INVITE` is a **conflict**: the token was fine, the caller's
 * relationship to it is what refuses — and they already know they minted it, so naming
 * the reason discloses nothing.
 *
 * **`PERSONAL_LINK_UNAVAILABLE` and `CONNECTION_REQUEST_UNAVAILABLE` are `NOT_FOUND` for
 * the same reason `INVITATION_UNAVAILABLE` is** (issue #206). The first is the sharper
 * case: a `FORBIDDEN`, or any distinct status for a rotated slug, would tell whoever kept
 * an old URL that it was once real and that its owner deliberately shed it. `NOT_FOUND` is
 * the answer an invented string gets, which is the only answer that keeps a rotation
 * private. Both codes stay uniform only because the domain raises **one** error class per
 * family — see those two classes — so this mapping cannot become an oracle by somebody
 * later giving one of the cases its own code.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code =
    error instanceof InvitationUnavailableError ||
    error instanceof NotConnectedError ||
    error instanceof PersonalLinkUnavailableError ||
    error instanceof ConnectionRequestUnavailableError
      ? 'NOT_FOUND'
      : error instanceof CannotAcceptOwnInviteError
        ? 'CONFLICT'
        : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * Every procedure body is the same three steps — call one operation, present the
 * result, translate an `ApplicationError` — so the translation lives here once. A
 * `try`/`catch` copied into five procedures is five places for the next `catch` to be
 * forgotten, and a forgotten one is a 500 carrying a message that was written for a
 * log rather than for a caller.
 */
async function present<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw asTrpcError(error);
    }
    throw error;
  }
}

/**
 * The connections module's tRPC surface.
 *
 * Five namespaces, because they are five different things a client does: mint and open
 * invites, accept one into a connection, record a private opinion about somebody you are
 * connected to, publish and rotate a personal address, and answer the requests that address
 * produces.
 *
 * ⚠ **`invitations` and `personalLink` are two models of the same product idea, and both
 * are live on purpose** (issue #206). An invite token is a bearer credential: whoever opens
 * it first is connected instantly and the token dies. A personal link is an address: opening
 * it connects nobody and the owner answers each request. #206 replaces the *minting* UI with
 * the second model and leaves the first reachable, because links already sitting in
 * somebody's chat history have to keep working — retiring `invitations.open` would turn
 * every one of them into the "this invite cannot be opened" screen that produced the issue.
 *
 * **No procedure takes an identifier for its caller** — `invitations.create` takes no
 * input at all, and the two that name another person call the field `subjectUserId` /
 * `otherUserId` rather than `userId`. ADR-0002:180-181 forbids the latter and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Every procedure is `authenticatedProcedure`: each one either creates state attached
 * to an actor or reads state scoped to one, so there is no version of any of them that
 * a signed-out caller could sensibly be given.
 */
export function createConnectionsRouter(dependencies: ConnectionsRouterDependencies) {
  return router({
    invitations: router({
      /** Mint an invite for the caller. The token is returned once and never listed. */
      create: authenticatedProcedure.mutation(
        async ({ ctx }): Promise<PresentedInvite> =>
          present(async () =>
            presentInvite(await dependencies.createInvite.create({ inviterId: ctx.actor.userId })),
          ),
      ),

      /**
       * What does this token get me?
       *
       * A query, not a mutation: opening changes nothing. Only accepting spends the
       * token, so a client may show the invite and let the person decide.
       */
      open: authenticatedProcedure
        .input(inviteTokenInput)
        .query(
          async ({ input }): Promise<PresentedOpenedInvite> =>
            present(async () => presentOpenedInvite(await dependencies.openInvite.open(input))),
        ),
    }),

    connection: router({
      /** Spend the token and connect. Idempotent for whoever spent it (M2-AC18). */
      accept: authenticatedProcedure
        .input(inviteTokenInput)
        .mutation(async ({ ctx, input }): Promise<PresentedConnection> =>
          present(async () => {
            const { connection } = await dependencies.acceptInvite.accept({
              actorId: ctx.actor.userId,
              token: input.token,
            });

            // Freshly accepted, so there is no trust yet — and there must not be a
            // shortcut that assumes so: `null` here is the same "unset" the read path
            // returns, not a placeholder for a value this response declined to fetch.
            return presentConnection({ status: connection.status, trust: null });
          }),
        ),

      /** The caller's own view of one connection, including their own trust. */
      get: authenticatedProcedure
        .input(getConnectionInput)
        .query(async ({ ctx, input }): Promise<PresentedConnection> =>
          present(async () =>
            presentConnection(
              await dependencies.getConnection.get({
                actorId: ctx.actor.userId,
                otherUserId: input.otherUserId,
              }),
            ),
          ),
        ),
    }),

    trust: router({
      /**
       * Record the caller's private, directional trust in somebody.
       *
       * Returns nothing. A response echoing the value back would be correct and
       * harmless today and is still not worth having: every payload that carries a
       * trust value is a payload M2-AC3 has to re-prove is unreachable by the other
       * party, and the caller already knows what they just sent.
       */
      set: authenticatedProcedure
        .input(setConnectionTrustInput)
        .mutation(async ({ ctx, input }): Promise<void> => {
          await present(async () => {
            await dependencies.setConnectionTrust.set({
              actorId: ctx.actor.userId,
              subjectUserId: input.subjectUserId,
              trust: input.trust,
            });
          });
        }),
    }),

    personalLink: router({
      /**
       * The caller's own permanent link, minted on first sight (issue #206).
       *
       * ⚠ **A mutation, and named `ensure` rather than `get` or `create`, because it is
       * honestly neither.** It writes — a caller who has never had a link gets one here —
       * so it cannot be a query without being a side-effecting GET; and it creates at most
       * once ever, so calling it `create` would describe the first call and mislead about
       * every one after it. The You screen calls it on arrival, which is exactly why the
       * idempotence has to be the database's (`on conflict (owner_id)`) rather than a
       * read-then-write two arrivals could both lose.
       *
       * ⚠ **A second call must never rotate.** That is the one bug this procedure could
       * have, and it would be silent: the screen would show a working link while every copy
       * already shared stopped resolving. `postgres-personal-link.repository.ts` keeps
       * `slug` out of its `do update` set for that reason.
       */
      ensure: authenticatedProcedure.mutation(
        async ({ ctx }): Promise<PresentedPersonalLink> =>
          present(async () =>
            presentPersonalLink(
              await dependencies.ensurePersonalLink.ensure({ ownerId: ctx.actor.userId }),
            ),
          ),
      ),

      /**
       * Mint a new slug and retire the old one, in one tap.
       *
       * Takes no input — not even the slug being replaced. There is one link a caller may
       * rotate and it is theirs; a `slug` field would let anybody holding the URL retire it.
       *
       * ⚠ **The old URL stops resolving immediately and answers the neutral refusal**, the
       * same one an invented slug gets. It never says "that link was retired": whoever kept
       * the old URL is frequently the reason the owner rotated.
       *
       * ⚠ **Nothing else moves.** Existing connections and already-received requests are
       * untouched — the statement names no other table — which is what makes rotating
       * something a person will actually do.
       */
      rotate: authenticatedProcedure.mutation(
        async ({ ctx }): Promise<PresentedPersonalLink> =>
          present(async () =>
            presentPersonalLink(
              await dependencies.rotatePersonalLink.rotate({ ownerId: ctx.actor.userId }),
            ),
          ),
      ),

      /**
       * Who does this link belong to?
       *
       * A query, and **opening changes nothing** — which is the entire difference from
       * `invitations.open`'s neighbour `connection.accept`, where the equivalent screen was
       * one tap from a connection the other person never agreed to.
       *
       * ⚠ It names a person to a caller who may be a stranger, which is ADR-0017 D4's
       * consent inversion applied to a published address rather than a §6a exception: the
       * card comes out of the owner's own `app.visible_people` self-projection, so a
       * deactivated owner has no card and the whole read refuses.
       *
       * Every refusal is 404 `PERSONAL_LINK_UNAVAILABLE` — unknown, rotated, and deactivated
       * are one answer.
       */
      open: authenticatedProcedure
        .input(personalLinkSlugInput)
        .query(async ({ ctx, input }): Promise<PresentedOpenedPersonalLink> =>
          present(async () =>
            presentOpenedPersonalLink(
              await dependencies.openPersonalLink.open({
                viewerId: ctx.viewerId,
                slug: input.slug,
              }),
            ),
          ),
        ),
    }),

    requests: router({
      /**
       * Ask the owner of a link to connect.
       *
       * The requester is the caller and cannot be anybody else, and the owner is named by
       * the *slug* rather than by an id — a procedure taking an `ownerId` would be a way to
       * request a connection with anybody whose id you could guess.
       *
       * ⚠ **Sending connects nobody.** It puts one row on the owner's inbox; they accept or
       * decline it, and only an acceptance makes an edge.
       *
       * Every refusal is 404 `PERSONAL_LINK_UNAVAILABLE`: an unknown slug, a rotated one, a
       * deactivated owner, your own link, a pair already connected, an ask you already have
       * open, a full inbox, and a link over its rate window are one answer. The last two are
       * folded in deliberately — "not accepting requests right now" is a statement about how
       * busy somebody's link is, told to whoever holds a URL.
       */
      send: authenticatedProcedure
        .input(personalLinkSlugInput)
        .mutation(async ({ ctx, input }): Promise<PresentedConnectionRequest> =>
          present(async () =>
            presentConnectionRequest(
              await dependencies.sendConnectionRequest.send({
                requesterId: ctx.actor.userId,
                slug: input.slug,
              }),
            ),
          ),
        ),

      /**
       * The requests waiting on the caller.
       *
       * Names no person at all: there is exactly one inbox a caller may read (ADR-0002 §5a),
       * so there is no parameter that could name a different one and no status filter that
       * could widen what it serves.
       *
       * ⚠ **There is deliberately no matching outbox.** A requester never reads their own
       * request back, which is what keeps a decline indistinguishable from a request nobody
       * has answered — ADR-0017's founding invariant, one relationship along. An acceptance
       * still reaches them: it discloses itself by connecting.
       */
      listInbox: authenticatedProcedure.query(
        async ({ ctx }): Promise<readonly PresentedIncomingConnectionRequest[]> =>
          present(async () =>
            (
              await dependencies.listConnectionRequests.list({ viewerId: ctx.viewerId })
            ).map(presentIncomingConnectionRequest),
          ),
      ),

      /**
       * Accept a request into a connection, or decline it.
       *
       * ⚠ **Accepting connects the two immediately**, unlike `intros.respond` — the edge is
       * written by the same transaction, because `app.connections` belongs to this module
       * and there is no boundary to route around (ADR-0018 D7). A client may say "you are
       * connected" rather than "you are being connected".
       *
       * Only the owner may. Anybody else — the requester, a stranger — gets the same 404
       * `CONNECTION_REQUEST_UNAVAILABLE` a request that never existed does, and so does one
       * already decided and one that has lapsed past its fourteen days.
       *
       * ⚠ **Declining reaches nobody.** No event is delivered to the requester and no read
       * shows it, so an owner can refuse without being seen to.
       */
      decide: authenticatedProcedure
        .input(decideConnectionRequestInput)
        .mutation(async ({ ctx, input }): Promise<PresentedConnectionRequest> =>
          present(async () =>
            presentConnectionRequest(
              await dependencies.decideConnectionRequest.decide({
                actorId: ctx.actor.userId,
                ...decideConnectionRequestCommandFields(input),
              }),
            ),
          ),
        ),
    }),
  });
}

/** The connections router's type, for the root router to mount it by. */
export type ConnectionsRouter = ReturnType<typeof createConnectionsRouter>;
